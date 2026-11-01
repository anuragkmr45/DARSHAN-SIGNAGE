# syntax=docker/dockerfile:1.7

ARG MINIO_GO_IMAGE=golang:1.24.8-bookworm@sha256:4ed690d6649d63c312b99a6120025ec79ce3b542968a37da53d6236c7c61a848
ARG MINIO_RUNTIME_IMAGE=alpine:3.22@sha256:2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f

FROM ${MINIO_GO_IMAGE} AS build

ARG MINIO_SOURCE_REPOSITORY=https://github.com/minio/minio.git
ARG MINIO_SOURCE_TAG=RELEASE.2025-10-15T17-29-55Z
ARG MINIO_SOURCE_COMMIT=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a

WORKDIR /src

# Fetch the official release ref and also verify its immutable commit. The tag is
# useful operator provenance; the commit check prevents a moved tag from
# silently changing a production image.
RUN git init . \
    && git remote add origin "${MINIO_SOURCE_REPOSITORY}" \
    && git fetch --depth 1 origin "refs/tags/${MINIO_SOURCE_TAG}" \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${MINIO_SOURCE_COMMIT}"

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    LDFLAGS="$(MINIO_RELEASE=RELEASE go run buildscripts/gen-ldflags.go)" \
    && CGO_ENABLED=0 go build \
      -tags kqueue \
      -trimpath \
      --ldflags "${LDFLAGS}" \
      -o /out/minio . \
    && /out/minio --version | grep -F "${MINIO_SOURCE_TAG}"

FROM ${MINIO_RUNTIME_IMAGE}

ARG MINIO_SOURCE_REPOSITORY=https://github.com/minio/minio.git
ARG MINIO_SOURCE_TAG=RELEASE.2025-10-15T17-29-55Z
ARG MINIO_SOURCE_COMMIT=9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a

LABEL org.opencontainers.image.title="MinIO for DARSHAN" \
      org.opencontainers.image.source="${MINIO_SOURCE_REPOSITORY}" \
      org.opencontainers.image.version="${MINIO_SOURCE_TAG}" \
      org.opencontainers.image.revision="${MINIO_SOURCE_COMMIT}"

RUN apk add --no-cache ca-certificates curl tzdata

COPY --from=build /out/minio /usr/bin/minio
COPY --from=build /src/LICENSE /usr/share/licenses/minio/LICENSE
COPY --from=build /src/CREDITS /usr/share/licenses/minio/CREDITS

EXPOSE 9000 9001
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/minio"]
CMD ["server", "/data"]
