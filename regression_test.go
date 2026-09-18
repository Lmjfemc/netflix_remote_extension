package main

import (
	"bufio"
	"encoding/json"
	"github.com/gorilla/websocket"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

type rotateOnUpgrade struct {
	http.ResponseWriter
	r *relay
}

func (w rotateOnUpgrade) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	w.r.receive(message{"type": json.RawMessage(`"rotate"`)})
	return w.ResponseWriter.(http.Hijacker).Hijack()
}
func TestRevokedKeyCannotFinishUpgrade(t *testing.T) {
	r := newRelay(0, func(any) error { return nil })
	defer r.close()
	old := r.key
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) { r.ServeHTTP(rotateOnUpgrade{w, r}, q) }))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)
	r.port, _ = strconv.Atoi(u.Port())
	c, _, e := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws?role=phone&key="+old, http.Header{"Origin": []string{srv.URL}})
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	c.SetReadDeadline(time.Now().Add(time.Second))
	_, _, e = c.ReadMessage()
	if !websocket.IsCloseError(e, 4002) {
		t.Fatalf("revoked socket must close without receiving state: %v", e)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.phone != nil {
		t.Fatal("revoked phone was registered")
	}
}
func TestRequestRefreshStillNotifiesPopup(t *testing.T) {
	r := newRelay(8787, func(any) error { return nil })
	defer r.close()
	r.addresses = []string{"10.0.0.1"}
	r.refreshed = time.Time{}
	r.addressesDirty = false
	r.listAddrs = func() []string { return []string{"10.0.0.2"} }
	if !r.validHost("10.0.0.2:8787") {
		t.Fatal("new host rejected")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	update := r.addressUpdate()
	if update == nil {
		t.Fatal("HTTP refresh swallowed notification")
	}
	links := update.(map[string]any)["links"].([]string)
	if !strings.Contains(links[0], "10.0.0.2:8787") {
		t.Fatal(links)
	}
	if r.addressUpdate() != nil {
		t.Fatal("unchanged address should not resend")
	}
}
func TestAuthenticationWaitsForHello(t *testing.T) {
	r := newRelay(8787, func(any) error { return nil })
	defer r.close()
	r.initializing = true
	previous := strings.Repeat("a", 48)
	request := func(p, body string) int {
		q := httptest.NewRequest("POST", "http://localhost:8787"+p, strings.NewReader(body))
		q.RemoteAddr = "127.0.0.1:20"
		q.Header.Set("Origin", "http://localhost:8787")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, q)
		return w.Code
	}
	for _, p := range []string{"/session", "/pair", "/setup", "/ws"} {
		if status := request(p, `{"key":"`+previous+`"}`); status != 503 {
			t.Fatalf("%s: %d", p, status)
		}
	}
	r.receive(message{"type": json.RawMessage(`"hello"`), "key": json.RawMessage(`"` + previous + `"`)})
	if request("/session", `{"key":"`+previous+`"}`) != 204 {
		t.Fatal("restored key rejected")
	}
	if request("/session", `{"key":"wrong"}`) != 401 {
		t.Fatal("invalid key accepted after init")
	}
}
