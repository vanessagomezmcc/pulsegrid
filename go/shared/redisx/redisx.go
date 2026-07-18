// Package redisx centralizes Redis key naming and connection setup. All
// short-lived demo state lives in Redis: session records, failure flags,
// simulated work queues, live metric snapshots, and the pub/sub channel that
// feeds the WebSocket gateway.
package redisx

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// Key naming. One place, no drift.
const (
	KeySessions      = "pulsegrid:sessions"   // SET of active session IDs
	KeySessionPrefix = "pulsegrid:session:"   // HASH per session (createdAt, lastSeen, scenario)
	LiveChannel      = "pulsegrid:live"       // pub/sub channel consumed by the WS gateway
	KeyQueuePrefix   = "pulsegrid:queue:"     // LIST per simulated work queue
	KeyLivePrefix    = "pulsegrid:livestate:" // per-session live snapshot JSON
	KeyDedupPrefix   = "pulsegrid:dedup:"     // SETNX-based event-id dedup
	KeyRatePrefix    = "pulsegrid:rate:"      // scenario-action rate limiting
)

// SessionTTL is how long an idle demo session survives.
const SessionTTL = 30 * time.Minute

// New builds a client from a redis:// URL.
func New(url string) (*redis.Client, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	return redis.NewClient(opts), nil
}

// QueueKey returns the Redis list key for a named simulated queue within a
// session, e.g. pulsegrid:queue:<session>:order-events.
func QueueKey(sessionID, queue string) string {
	return KeyQueuePrefix + sessionID + ":" + queue
}

// TouchSession refreshes a session's TTL and lastSeen; returns false when the
// session does not exist (expired or never created).
func TouchSession(ctx context.Context, rdb *redis.Client, sessionID string) (bool, error) {
	key := KeySessionPrefix + sessionID
	n, err := rdb.Exists(ctx, key).Result()
	if err != nil || n == 0 {
		return false, err
	}
	pipe := rdb.Pipeline()
	pipe.HSet(ctx, key, "lastSeen", time.Now().UTC().Format(time.RFC3339))
	pipe.Expire(ctx, key, SessionTTL)
	_, err = pipe.Exec(ctx)
	return true, err
}

// ActiveSessions lists session IDs whose hash still exists, pruning dead
// members from the index set as a side effect.
func ActiveSessions(ctx context.Context, rdb *redis.Client) ([]string, error) {
	ids, err := rdb.SMembers(ctx, KeySessions).Result()
	if err != nil {
		return nil, err
	}
	alive := ids[:0]
	for _, id := range ids {
		n, err := rdb.Exists(ctx, KeySessionPrefix+id).Result()
		if err != nil {
			return nil, err
		}
		if n == 0 {
			rdb.SRem(ctx, KeySessions, id)
			continue
		}
		alive = append(alive, id)
	}
	return alive, nil
}
