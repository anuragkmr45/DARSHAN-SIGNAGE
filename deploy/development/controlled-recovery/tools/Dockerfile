FROM postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea AS wrapper-build

ARG BUILD_BASE_APK_VERSION
ARG WRAPPER_SOURCE_SHA256
ARG WRAPPER_BINARY_SHA256
COPY darshan-d3-tool.c /build/darshan-d3-tool.c
RUN test -n "${BUILD_BASE_APK_VERSION}" \
    && test -n "${WRAPPER_SOURCE_SHA256}" \
    && printf '%s  %s\n' "${WRAPPER_SOURCE_SHA256}" /build/darshan-d3-tool.c | sha256sum -c - \
    && apk add --no-cache --virtual .d3-wrapper-build "build-base=${BUILD_BASE_APK_VERSION}" \
    && mkdir -p /out \
    && cc -std=c11 -Os -Wall -Wextra -Werror -static -ffunction-sections -fdata-sections -Wl,--gc-sections -Wl,-z,noexecstack /build/darshan-d3-tool.c -o /out/darshan-d3-tool \
    && chmod 0555 /out/darshan-d3-tool \
    && apk del .d3-wrapper-build \
    && ! test -x /usr/bin/cc \
    && ! test -x /usr/bin/gcc \
    && test "$(stat -c '%a' /out/darshan-d3-tool)" = 555 \
    && /out/darshan-d3-tool --self-test \
    && if /out/darshan-d3-tool /usr/bin/env; then exit 1; fi \
    && cd /out \
    && sha256sum darshan-d3-tool > darshan-d3-tool.sha256 \
    && sha256sum -c darshan-d3-tool.sha256 \
    && if test -n "${WRAPPER_BINARY_SHA256}"; then printf '%s  %s\n' "${WRAPPER_BINARY_SHA256}" darshan-d3-tool | sha256sum -c -; fi \
    && cat darshan-d3-tool.sha256

FROM postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea

ARG AGE_APK_VERSION
ARG FFMPEG_APK_VERSION
ARG BUILD_BASE_APK_VERSION
ARG WRAPPER_SOURCE_SHA256
COPY --from=wrapper-build /out/darshan-d3-tool /usr/local/bin/darshan-d3-tool
COPY --from=wrapper-build /out/darshan-d3-tool.sha256 /usr/local/share/darshan-d3-tool.sha256
RUN test -n "${AGE_APK_VERSION}" \
    && test -n "${FFMPEG_APK_VERSION}" \
    && apk add --no-cache "age=${AGE_APK_VERSION}" "ffmpeg=${FFMPEG_APK_VERSION}" \
    && cd /usr/local/bin \
    && sha256sum -c /usr/local/share/darshan-d3-tool.sha256 \
    && test "$(stat -c '%a' /usr/local/bin/darshan-d3-tool)" = 555 \
    && ! test -x /usr/bin/cc \
    && ! test -x /usr/bin/gcc \
    && /usr/local/bin/darshan-d3-tool --self-test \
    && /usr/local/bin/darshan-d3-tool /usr/bin/age --version \
    && /usr/local/bin/darshan-d3-tool /usr/bin/age-keygen --version \
    && /usr/local/bin/darshan-d3-tool /usr/bin/ffmpeg -version \
    && /usr/local/bin/darshan-d3-tool /usr/bin/ffprobe -version

LABEL com.darshan.development-only="true" \
      com.darshan.d3.role="container-tools" \
      com.darshan.d3.age-apk-version="${AGE_APK_VERSION}" \
      com.darshan.d3.ffmpeg-apk-version="${FFMPEG_APK_VERSION}" \
      com.darshan.d3.wrapper-source-sha256="${WRAPPER_SOURCE_SHA256}" \
      com.darshan.d3.wrapper-umask="0077" \
      com.darshan.d3.wrapper-build-base-apk-version="${BUILD_BASE_APK_VERSION}"

USER 65532:65532
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/darshan-d3-tool"]
CMD ["/usr/bin/age", "--version"]
