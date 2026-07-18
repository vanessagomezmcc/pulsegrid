package main

import (
	"encoding/json"
	"strconv"
)

// decode unmarshals a request body into T.
func decode[T any](body []byte) (T, error) {
	var v T
	err := json.Unmarshal(body, &v)
	return v, err
}

func itoa(n int) string { return strconv.Itoa(n) }
