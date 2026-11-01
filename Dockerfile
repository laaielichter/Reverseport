# ReversePort's MCP server on stdio, from the published npm package (the same build `npx reverseport mcp` runs).
# Directories such as Glama start it to list the tools. Targets are read from mounted folders; the workspace
# (plans, extracted files, reports) is /data.
#
#   docker build -t reverseport .
#   docker run -i --rm -v "$PWD:/work:ro" -v reverseport-data:/data reverseport
FROM node:24.22.1-slim

# The version in package.json, so the image matches this checkout's release.
COPY package.json /tmp/reverseport-package.json
RUN npm install --global --no-audit --no-fund \
      "reverseport@$(node -p "require('/tmp/reverseport-package.json').version")" \
  && npm cache clean --force \
  && rm /tmp/reverseport-package.json

RUN mkdir -p /data /work && chown node:node /data /work
ENV REVERSEPORT_HOME=/data
VOLUME ["/data"]
WORKDIR /work
USER node
ENTRYPOINT ["reverseport", "mcp"]
