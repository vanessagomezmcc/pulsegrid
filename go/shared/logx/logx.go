// Package logx configures structured JSON logging (stdlib slog) with the
// fields PulseGrid uses everywhere: service, instance, and optional trace IDs.
package logx

import (
	"log/slog"
	"os"
)

// New returns a JSON slog.Logger tagged with service identity.
func New(service, instance string) *slog.Logger {
	level := slog.LevelInfo
	if os.Getenv("LOG_LEVEL") == "debug" {
		level = slog.LevelDebug
	}
	h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})
	return slog.New(h).With("service", service, "instance", instance)
}
