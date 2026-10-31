FROM alpine:3.22

RUN apk add --no-cache \
      aws-cli \
      bash \
      ca-certificates \
      coreutils \
      findutils \
      flock \
      postgresql15-client \
      tzdata

COPY run-backup.sh /usr/local/bin/darshan-backup

RUN chmod 0555 /usr/local/bin/darshan-backup

ENTRYPOINT ["/usr/local/bin/darshan-backup"]
CMD ["loop"]
