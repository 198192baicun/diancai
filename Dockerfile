# Development HTTP/SQLite service. Production acceptance remains separate.
FROM node:24.16.0-bookworm-slim@sha256:ca520832af80fa37a57c14077ed0fcdd83b5aefccc356059fdc3a9a05b78ae1f

LABEL org.opencontainers.image.title="diancai development server" \
      org.opencontainers.image.description="Single-household LAN HTTP/SQLite development implementation" \
      org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app
ENV NODE_ENV=development \
    HOST=0.0.0.0 \
    PORT=3000 \
    FAMILY_DATA_ROOT=/data/current \
    FAMILY_TIMEZONE=Asia/Shanghai \
    TZ=Asia/Shanghai

# Verify the actual runtime; never bypass the SQLite floor in the container.
RUN node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:'); const v=db.prepare('select sqlite_version() as v').get().v; const a=v.split('.').map(Number); console.log(JSON.stringify({node:process.version,sqlite:v,platform:process.platform,arch:process.arch})); if(process.platform!=='linux'||process.arch!=='x64'||Number(process.versions.node.split('.')[0])!==24||a[0]<3||(a[0]===3&&(a[1]<51||(a[1]===51&&a[2]<3)))) process.exit(1); db.close();"

RUN groupadd --gid 10001 diancai \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin diancai \
    && mkdir -p /data \
    && chown 10001:10001 /data

# This runtime has no external npm dependencies. Copy only runtime sources.
COPY server/src/ ./server/src/
COPY server/migrations/*.sql ./server/migrations/
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY licenses/ ./licenses/

USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/health/ready',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/server.cjs"]
