# Generic multi-stage build for every Go binary; SERVICE selects the target.
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY go ./go
COPY services ./services
ARG SERVICE
RUN test -n "$SERVICE" || (echo "SERVICE build arg not needed at build; building all" && true)
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/ ./services/...

FROM alpine:3.20
RUN adduser -D -u 10001 pulsegrid && apk add --no-cache curl
USER pulsegrid
COPY --from=build /out/ /usr/local/bin/
# SERVICE env decides which binary runs (compose sets it per container).
ENTRYPOINT ["/bin/sh", "-c", "exec /usr/local/bin/${SERVICE}"]
