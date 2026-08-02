# Playwright worker.
#
# NOT DEPLOYED — no Fly.io credentials exist in this environment, so this image
# has never been built or pushed. It is committed because the worker needs a
# container to run in and the shape of that container is a code decision, but
# treat it as unverified until someone builds it.
#
# The base image ships Chromium and its system dependencies, which is why the
# worker cannot run on Vercel: these runs take 2-10 minutes and need a
# persistent browser.
FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile --filter @vendorlink/worker...

# Never run the browser as root.
USER pwuser

CMD ["pnpm", "--filter", "@vendorlink/worker", "start"]
