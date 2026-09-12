# HTTP API 设计契约

本文件是首期接口语义的唯一设计来源。仓库中的 HTTP/SQLite 开发运行实现与原生小程序均以本契约为准；当前未生成或宣称存在 OpenAPI 文件或独立客户端 SDK。原型模型使用简写字段，不能未经映射直接当 HTTP DTO。

## 1. 通用结构

前缀 `/api`；JSON UTF-8；字段采用 camelCase；ID 为不透明字符串。成功响应 `{"data":...,"meta":{"requestId":"...","instanceId":"...","dataEpoch":"...","today":"YYYY-MM-DD"}}`，时间戳 UTC ISO 8601；`meta.today` 统一按 `Asia/Shanghai` 计算，业务日界线为北京时间 00:00。空资源使用 `null`，不以 `{}` 代替。成功状态为 200 或创建时 201；幂等成功重放可返回 200，data 内容与首次一致。

失败响应：

```json
{"error":{"code":"STATE_CONFLICT","message":"这道菜已被认领","details":{"latest":{}}},"meta":{"requestId":"...","instanceId":"...","dataEpoch":"...","today":"2026-09-10"}}
```

真实 `latest` 是对应完整资源，不返回空对象。400 参数不合法；403 当前成员不可执行；404 不存在；409 状态/版本/幂等/日期/代次冲突；413 文件过大；415 格式不支持；422 批次含不可用菜；503 维护/资源暂不可用。未知错误 500，不泄漏绝对路径/SQL。

除健康/服务识别/初始化/选择成员所需读取外，业务请求需 `X-Member-Id`；所有修改需 `X-Instance-Id`、`X-Data-Epoch` 并校验。安全模型是可信 LAN，不把这些 Header 标成 bearer 认证。GET receipt 是历史成功回执只读核对，允许已停用但存在的原成员在正确上下文中读自己的凭据。

分页：客户端统一 `page_size=10`；服务默认 10 条，兼容既有 `limit` 范围1—50；显式 page_size 非10返回400；`cursor` 为不可构造的服务端游标，包含稳定排序位置并绑定过滤条件，条件不符返回400。响应 `items,nextCursor,total`（total 为当前筛选的服务端总数）。按不可变的创建时间与 ID 排序；菜单日期作为菜单相关列表的首排序键，历史按日期倒序，菜品按创建时间倒序。游标签名绑定路由和筛选条件，涉及当前成员的数据同时绑定成员；服务重启后旧游标失效并返回400，客户端须刷新列表。它不是跨请求的数据快照，新数据和状态变化通过刷新重新读取。原型不模拟真实分页数据量。请求体关闭未知字段，路径/查询与体均校验。

## 2. 核心 DTO

`Member={id,name,active,avatarMediaId:null|string}`，`Category={id,name,active}`。

`Media={id,originalName,detectedMime,byteSize,sha256,previewPolicy:"inline"|"download",contentUrl:null|string,downloadUrl,createdAt}`。

`Dish={id,name,categoryId,active,estimatedMinutes:null|integer,introduction,coverMediaId:null|string,steps:[{id,position,content,mediaId:null|string}],revision,rating:{average:null|number,count:integer},createdBy,createdAt,updatedAt}`。

`MenuItem={id,menuDate,dishId,dishName,categoryName,coverMediaId,orderedBy,orderedName,note,status,cookId:null|string,cookName:null|string,claimedAt,completedAt,cancelledBy,cancelledName,cancelledAt,cancelReason,sourceVoteId,sourceItemId,revision,createdAt,updatedAt,allowedActions:[string]}`。

允许动作由后端按当前成员计算，前端同时依据状态展示，不把隐藏按钮作为权限边界。无权限时直接请求动作仍须403。

`Review={id,menuItemId,dishId,reviewDate,memberId,memberName,rating,comment,createdAt,updatedAt}`。`menuItemId` 是证明该菜在 `reviewDate` 已完成的来源事项；唯一性按成员、菜品、菜单日期判断。

`Vote={id,title,initiatorId,initiatorName,status,createdAt,closedAt,winnerDishId:null|string,candidates:[{dishId,dishName,coverMediaId,votes}],myDishIds:[string],participantCount,addedItem:null|{id,menuDate,status}}`。`myDishIds` 是当前成员选择的全部候选；`participantCount` 按至少选择一道候选的成员去重，不因成员停用扣减。

`Receipt={idempotencyKey,targetDate,menuItemIds:[id],submittedAt}`；当条目之后完成/取消，回执返回原 ID，不返回已过时状态替代实时详情。

## 3. 家庭和资料

| 方法与路径 | 输入与输出 |
|---|---|
| GET `/health/live` | 200 `{status:"alive"}`，不读业务库 |
| GET `/health/ready` | 可服务200；否则503；允许本机健康探针 Host，不能因此扩大业务 Host 白名单 |
| GET `/api/system` | 返回 initialized、familyName、timezone、today、instanceId、dataEpoch、schemaVersion、apiVersion；timezone 固定为 Asia/Shanghai（未初始化时同样返回）；未初始化名称、实例等家庭字段可空 |
| POST `/api/setup` | `{familyName,members:[{name}]}`，成员1—20；timezone 由服务端固定写入 Asia/Shanghai，客户端传入该未知字段返回400；一次事务，只能成功一次 |
| GET `/api/members` | 默认启用；`includeInactive=true` 仅业务已选成员可访问 |
| POST `/api/members` | `{name}` → Member |
| PATCH `/api/members/{id}` | `{name}` → Member；只允许改名 |
| GET `/api/members/{id}/dependencies` | `{pendingItems,cookingItems,activeVotes,lastActiveMember}`，条目可分页；汇总给总数 |
| POST `/api/members/{id}/status` | `{active:boolean}` → Member；停用按全日期依赖与最后成员保护 |
| GET `/api/categories` | 启用列表；`includeInactive=true` 管理视图 |
| POST `/api/categories` | `{name}` → Category |
| PATCH `/api/categories/{id}` | `{name}` → Category |
| POST `/api/categories/{id}/status` | `{active:boolean}`；仍有上架菜不可停用 |
| PATCH `/api/family` | `{name}`；不含在线改时区或数据恢复 |
| GET `/api/dishes` | `q,categoryId,active=true|false|all,cursor,limit`；默认只列可点菜，all 为公共管理 |
| GET `/api/dishes/{id}` | Dish；下架可读，rating 从评价聚合 |
| POST `/api/dishes` | `{name,categoryId,estimatedMinutes,introduction,coverMediaId,steps:[{content,mediaId}]}` |
| PUT `/api/dishes/{id}` | 同创建字段 + `expectedRevision`；完整资料与步骤原子保存 |
| POST `/api/dishes/{id}/status` | `{active,expectedRevision}`；active投票候选不许下架 |
| GET `/api/dishes/{id}/reviews` | `cursor,limit` → Review 列表 |

成员与分类短表单为明确的最后写入者生效；冲突大的菜谱用 revision。修改短表单前后的快照名称各自按来源时点保存，不回写历史。

## 4. 菜单、提交和评价

| 方法与路径 | 语义 |
|---|---|
| GET `/api/menu` | 必填 `date`；另有 `status,view,cursor,limit`；`view=archive` 时只返回该日期 completed/cancelled，返回对应状态计数 |
| GET `/api/menu/unfinished` | 所有 `menuDate<today AND status IN(pending,cooking)`，游标分页；按日期旧到新排列 |
| GET `/api/menu-items/{id}` | 特定事项完整 DTO；允许原日期继续处理 |
| POST `/api/menu/batches` | 下述批次 body；幂等 Key 必填；成功 Receipt |
| GET `/api/menu/batches/receipts/{key}` | 原成员+实例+代次核对；有回执200，无回执404（不是允许换 Key 的授权） |
| PATCH `/api/menu-items/{id}/note` | `{note,expectedRevision}`；本人待做；note:null 规范成空字符串 |
| POST `/api/menu-items/{id}/claim` | `{expectedRevision}`；任意启用成员认领待做 |
| POST `/api/menu-items/{id}/unclaim` | `{expectedRevision}`；当前做菜人 cooking → pending |
| POST `/api/menu-items/{id}/complete` | `{expectedRevision}`；当前做菜人 cooking → completed |
| POST `/api/menu-items/{id}/cancel` | `{expectedRevision,reason:null|string}`；pending点菜人或cooking做菜人 |
| GET `/api/menu-items/{id}/reviews` | 该事项对应菜品与菜单日期的有效当日评价列表；同日同菜重复事项返回同一组评价 |
| PUT `/api/menu-items/{id}/my-review` | `{rating,comment}`；rating1—5整数，comment可空；以该 completed 事项证明菜品与菜单日期，同成员同菜同日只允许首次提交，已有评价返回 `REVIEW_ALREADY_SUBMITTED`，不允许更新 |
| GET `/api/me/tasks` | 当前成员已认领且 cooking 的全日期事项，`cursor,limit`；按 menuDate、createdAt、id 升序，返回 `items,nextCursor,total` |
| GET `/api/me/orders` | 当前成员点菜，`dateFrom,dateTo,status,cursor,limit` |
| GET `/api/me/reviews` | 当前成员评价，游标分页，附对应事项摘要 |
| GET `/api/history` | `beforeDate,cursor,limit` 返回过去日期已自动归档的 completed/cancelled 汇总；只含未完成事项的日期不返回，详情使用 `/menu?date=&view=archive` |

批次 body：

```json
{"targetDate":"2026-09-10","items":[{"dishId":"dish_a","note":"少盐","sourceItemId":null},{"dishId":"dish_a","note":null,"sourceItemId":"historical_item_b"}]}
```

items1—50；按顺序创建不同 ID；sourceItemId 不为空时必须属于同一 dish。历史复点统一经过该端点，不另造批量协议。事务先查成功回执，再校验首次执行的目标日期。错误详情包含 `invalidItems:[{index,dishId,reason}]`；全批次失败无部分写入。

稳定错误码至少：`INVALID_INPUT`、`NAME_EXISTS`、`MEMBER_INACTIVE`、`MEMBER_IN_USE`、`LAST_ACTIVE_MEMBER`、`CATEGORY_IN_USE`、`DISH_UNAVAILABLE`、`FORBIDDEN`、`STATE_CONFLICT`、`VERSION_CONFLICT`、`DATE_CHANGED`、`DATA_EPOCH_CHANGED`、`INSTANCE_CHANGED`、`IDEMPOTENCY_MISMATCH`、`RECEIPT_NOT_FOUND`。

## 5. 投票

| 方法与路径 | 语义 |
|---|---|
| GET `/api/votes/entry` | `{active:Vote|null,latestResult:Vote|null}`；结果包括finished/cancelled；新active不抹掉最近已结束入口 |
| GET `/api/votes/{id}` | 当前/已结束具体轮次，保留深链入口，历史列表见 GET /api/votes |
| POST `/api/votes` | `{title,dishIds:[id]}`；2—10道不同可点菜；已有active返回409和该轮ID |
| PUT `/api/votes/{id}/my-ballot` | `{dishIds:[id],note?:string,voiceMediaId?:null|string}`；0—10 个且必须属于本轮候选；active 且 votingClosedAt 为空时在事务内原子替换当前成员的全部选择，空数组表示取消全部；返回当前 Vote |
| POST `/api/votes/{id}/finish` | `{winnerDishId:null|string}`；唯一最高自动定，当前并列需选择；事务重新计票，不采信客户端票数 |
| POST `/api/votes/{id}/cancel` | `{}`；仅发起人，active→cancelled，无winner |
| POST `/api/votes/{id}/menu-item` | `{targetDate}`；优先查已有sourceVote条目，再验证首次创建日期/成员/获胜菜；返回原或新MenuItem，不重复创建 |

`TIE_REQUIRES_SELECTION` 带当前并列候选；用户选择期间票数可能变化，再请求需按事务当下票数判断。非并列但传了非最高 winner 要返回 `INVALID_WINNER`，不能依据过期选择产生错误winner。原型的简化选择交互不代表客户端有最终裁决权。

## 6. 文件

`POST /api/media`：multipart 单 file，最大52,428,800字节，流式验证；返回 Media。原文件名只用于信息和下载建议名，不能进入服务器路径。

`GET /api/media/{id}`：Media 元数据；`GET /api/media/{id}/content`：仅inline可原字节展示，download类返回明确不可内联；`GET /api/media/{id}/download`：原字节附件。文件读取允许不携带成员 Header 以支持小程序图片组件，但仍受家庭网络边界、路径和 Host 策略控制；媒体随机ID不能称为认证凭证。

元信息返回 SHA-256 与准确byteSize，验收对原文件逐字节散列比较。没有DELETE媒体HTTP接口；孤儿清理由离线维护完成。没有备份、恢复、维护任务或Docker控制的HTTP接口。


## 7. 图文教程读取

`POST /api/recipe-imports`：`{shareText:string}`，最多 10000 个 UTF-16 代码单元，仅一个 HTTPS 分享链接。需要启用成员和正确实例/代次。公开页面解析与图片 I/O 不占用数据库长事务；每张完整图片登记前以及全部完成后重新检查写上下文。

成功返回 `{name,introduction,coverMediaId,steps:[{content,mediaId}],media:[Media],sourceURL,notice}`。这些是编辑草稿素材，不是已创建的 Dish；不创建菜品和菜单事项。正文按 Unicode 码点每段最多 2000 分段，完整标题保留在正文中，建议菜名最多 50 字。图片顺序保留，每图对应一个“教程原图”段落。不识别图中文字。

只接受小红书页面域名和 xhscdn.com 图片 CDN，逐次检查 HTTPS 跳转并将连接固定到检查后的公网 DNS 地址；拒绝回环、内网、保留地址、嵌入凭据和非标准端口，不执行页面脚本、不访问登录态。系统 DNS 失败或返回非公网地址时，通过固定 1.1.1.1 地址连接 cloudflare-dns.com 的 HTTPS DNS（保留 TLS 校验），回退结果仍须全部为公网 IPv4；失败返回422 `IMPORT_UNAVAILABLE`。只向解析服务发送域名，不发送分享路径或正文。当前小红书公开 INITIAL_STATE 图文有解析实现；抖音及其他非白名单链接返回400 `INVALID_IMPORT_URL`，小红书无法公开解析的页面返回422 `IMPORT_UNAVAILABLE`，不得用标题或链接冒充完整教程。

错误：400 `INVALID_IMPORT_URL`/`INVALID_INPUT`；422 `IMPORT_UNAVAILABLE`；413 `FILE_TOO_LARGE`。平台变更、访问受限、图片不完整时返回明确错误。单图最多52,428,800字节，合计200MiB，图文合计50段；已接收文件遵循孤儿媒体停服清理规则。客户端不得在超时后自动重试或自动保存为菜品。

菜谱编辑草稿是客户端本机存储结构，不新增服务端草稿表。我的待做复用 menu_item；数据库使用有序迁移升级至 schema 3，保留既有资料、回执、票数和评价。


## 8. 成果与语音扩展（schema 3）

所有写接口继续使用启用成员、实例与数据代次检查；以下扩展在原业务事务中校验，失败整体回滚。媒体 ID 不存在或类别不匹配返回400 `INVALID_INPUT`；图片字段只接受 image/*，语音字段只接受 audio/*，文件上限不变。

- Dish 追加 `voiceMediaId:null|string`；创建/更新资料接受同名可选字段，更新缺省保留，显式 null 清空。与资料和步骤同事务、同 revision。
- 批次每项追加 `noteVoiceMediaId?:null|string`，非空引用纳入原载荷散列与回执保护；缺省不改变旧载荷的散列。MenuItem 返回 `noteVoiceMediaId,claimVoiceMediaId,completionVoiceMediaId`（均可空）、`completionNote:string` 与按顺序排列的 `photoMediaIds:string[]`。
- PATCH note 接受可选 `voiceMediaId`；POST claim 接受可选 `voiceMediaId`。POST complete 接受 `{expectedRevision,photoMediaIds?:string[],completionNote?:string,voiceMediaId?:null|string}`；照片0—9张、心得0—200字。图片引用与完成状态同事务保存，仅当前做菜人可执行。原终态不可重写，超时先 GET 事项核对。取消认领清空当前认领语音。
- PUT my-review 接受 `voiceMediaId?:null|string`，Review 返回同名字段，与评分正文首次插入，提交后不可修改。createdAt 是实际评价时刻，reviewDate 是菜单日期；客户端将 UTC 时刻转换为北京时间。
- PATCH `/api/me/avatar` 接受 `{avatarMediaId:null|string}`，仅更新当前操作者，返回 Member；显式 null 清空。客户端主动选择微信头像或上传本机图片，再使用普通媒体上传取得引用。
- HistorySummary 返回 `{menuDate,itemNames,itemCount,completedCount,cancelledCount,cooks:string[],photoMediaIds:string[],hasUnfinished:false,rating}`；日期封面照片按事项创建时间与图片顺序取前9张，详情保留全部事项照片。

POST media 支持图片及 MP3/WAV 语音原文件；语音使用 inline 策略提供原字节播放，具体设备播放能力需真机验证。引用继续受外键保护，无在线删除路径。客户端录音最长60秒；服务只验证识别类型与文件字节上限，不承诺对任意上传音频执行时长解析。

## 9. 投票收齐、历史及公示

Vote 追加 `votingClosedAt:null|string,enabledMemberCount:number,myNote:{note,voiceMediaId},ballots:[{memberId,memberName,note,voiceMediaId,updatedAt,dishIds:string[]}]`。进行中且未停收的 ballots 为空；停止收票、结束或取消后返回保存的成员姓名、选中候选、备注和语音。旧票在迁移时以现存成员名称补齐展示记录，不伪造旧名称。

每次保存选择和成员启停事务检查当前启用成员是否全部至少投一道；若是，写 votingClosedAt。唯一最高同事务写 finished/winner/closedAt；并列保留 active，不能改票和开第二轮，由发起人调用 finish 从并列最高中选定。停收后成员变化不重新开放；所有已保存票包含停用成员票继续计数。提前结束或取消仍限发起人，提前并列的选择请求仍以事务实际票数为准。客户端票数、完成判断均不作为权限依据。

GET `/api/votes?page_size=10&cursor=...` 返回所有轮次 `items:Vote[],nextCursor,total`，按 createdAt、id 倒序。历史读取需要已存在的成员。加入菜单仍按 sourceVote 唯一约束重放，生成 pending 事项，取消事项不解锁再次加入。

## 10. 随机与统计

GET `/api/dishes/random?count=N`：启用成员读取，N 为1—50整数；返回 `{items:Dish[]}`，只含当前可点菜，同组不重复。数量不足返回422 `NOT_ENOUGH_DISHES`；不创建菜单、不返回回执。客户端确认后使用既有草稿和批次端点再次校验可点性。

GET `/api/dashboard`：已存在成员可读。返回 `{today,totals:{total,pending,cooking,completed,cancelled,days},rating:{count,average},popular:[{dishId,dishName,count}],cooks:[{memberId,memberName,count}],trend:[{date,count,completed}],activeMembers,dishCount,voteCount}`。空状态聚合为0，average 无评价为null。热门菜排除取消、按次数倒序取前10；贡献只计完成、取前10；趋势取最近10个有效菜单日期。全历史统计，不接收客户端修改统计值。

## 11. 导入执行限制

同一篇配图最多三路并发，按原顺序收集。并发累计总字节仍共享200MiB上限，任一失败整篇不返回成功草稿，等待在途工作结束再返回。每个下载请求有空闲15秒和绝对25秒超时，整次公开网络读取100秒截止；只对配图建立连接时的非业务网络错误重试一次。解析过的安全公网地址最多缓存30秒且每次连接固定该地址，跳转仍逐次检查，不缓存失败。导入中的读取不代表已创建菜品，客户端超时不自动重发。
