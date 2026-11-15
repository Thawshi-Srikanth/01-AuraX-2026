# Versioned releases

[Documentation](README.md) · [Deployment](deployment.md) · [Releases](https://github.com/Thawshi-Srikanth/01-AuraX-2026/releases)

## Choose a version for deployment

Use a completed GitHub Release such as **v1.0.0**, then set this in the server's existing environment file:

```dotenv
IMAGE_TAG=v1.0.0
```

Both frontend and backend use the same version. Exact release tags avoid copying a long commit hash. Full `sha-COMMIT` tags remain supported for verified builds.

Versions use **vMAJOR.MINOR.PATCH**:

| Example | Purpose |
| --- | --- |
| v1.0.0 | Initial numbered release |
| v1.0.1 | Compatible bug fix |
| v1.1.0 | Compatible feature addition |
| v2.0.0 | Breaking change requiring migration/review |

Use complete names such as v1.2.0 rather than v1 or v1.2. There are no moving latest/major/minor aliases. Never move or reuse a published version for a different commit; publish a new version instead.

## Update the existing HTTPS deployment

From the existing deployment directory, edit only IMAGE_TAG and preserve all other settings. For the aurax-public project:

```sh
docker compose -p aurax-public -f compose.prod.yml -f compose.tls.yml pull
docker compose -p aurax-public -f compose.prod.yml -f compose.tls.yml up -d --no-build --wait --wait-timeout 150
docker compose -p aurax-public -f compose.prod.yml -f compose.tls.yml ps
```

Keep your actual project name and configuration files. A routine update needs no down command or volume deletion. To roll back, choose a previous compatible completed release and repeat pull/up.

## Publish the next version

Maintainers with repository push access can create a version from reviewed main:

```sh
git switch main
git pull --ff-only
git tag -a v1.1.0 -m "AURAx v1.1.0"
git push origin v1.1.0
```

Choose a fresh version and update the [changelog](../CHANGELOG.md) before tagging. Do not force-push tags. Tagging an older commit that lacks the release workflow does not retroactively add version publishing.

## What automation verifies

A v-prefixed tag triggers the container workflow. The workflow rejects incomplete/malformed versions and source commits outside main's history. It exercises isolated production, HTTPS, and development containers, publishes matching multiarchitecture images with version and commit tags, and deploys the published **version-tagged pair** without rebuilding.

Only after that deployment succeeds does the workflow create the GitHub Release with its deployment tag, source commit, and verification link. Unit-test results and archive availability remain separate from these container checks.

A tag or a partly published image is not sufficient evidence of completion. Wait for the entire workflow and the GitHub Release. If a run fails, inspect it before deploying or creating another version.

Main pushes continue publishing SHA tags when relevant files change. Documentation-only commits need not publish images. The current Git commit and newest available deployable version can therefore differ.
