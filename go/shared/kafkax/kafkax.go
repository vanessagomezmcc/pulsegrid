// Package kafkax wraps franz-go with the small producer surface PulseGrid's
// services need: fire-and-forget telemetry publication keyed by trace ID (so
// all spans of one trace land in one partition, preserving order), with
// bounded retries and graceful flush on shutdown.
package kafkax

import (
	"context"
	"log/slog"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

// Producer publishes telemetry records to Redpanda.
type Producer struct {
	client *kgo.Client
	log    *slog.Logger
}

// NewProducer connects to the given brokers. Retries are bounded by franz-go's
// internal policy; PulseGrid additionally treats publish failures as
// non-fatal for the request path (telemetry loss must never fail a request).
func NewProducer(brokers []string, log *slog.Logger) (*Producer, error) {
	client, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
		kgo.ProducerBatchMaxBytes(1<<20),
		kgo.RecordRetries(5),
		kgo.RequestTimeoutOverhead(10*time.Second),
	)
	if err != nil {
		return nil, err
	}
	return &Producer{client: client, log: log}, nil
}

// Publish sends one record asynchronously. Errors are logged, never bubbled
// into the hot path.
func (p *Producer) Publish(ctx context.Context, topic, key string, value []byte) {
	rec := &kgo.Record{Topic: topic, Key: []byte(key), Value: value}
	p.client.Produce(ctx, rec, func(r *kgo.Record, err error) {
		if err != nil {
			p.log.Error("kafka publish failed", "topic", r.Topic, "error", err)
		}
	})
}

// PublishSync sends one record and waits for the broker ack. Used by the API
// for scenario actions (e.g. malformed-event injection) where the caller needs
// confirmation.
func (p *Producer) PublishSync(ctx context.Context, topic, key string, value []byte) error {
	rec := &kgo.Record{Topic: topic, Key: []byte(key), Value: value}
	return p.client.ProduceSync(ctx, rec).FirstErr()
}

// Close flushes outstanding records then closes the client.
func (p *Producer) Close(ctx context.Context) {
	flushCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := p.client.Flush(flushCtx); err != nil {
		p.log.Warn("kafka flush on shutdown incomplete", "error", err)
	}
	p.client.Close()
}
