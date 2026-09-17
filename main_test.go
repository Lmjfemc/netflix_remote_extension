package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestNativeFraming(t *testing.T) {
	var b bytes.Buffer
	if e := writeNative(&b, map[string]string{"type": "state", "title": "줄거리"}); e != nil {
		t.Fatal(e)
	}
	m, e := readNative(&b)
	if e != nil || field(m, "title") != "줄거리" {
		t.Fatalf("roundtrip: %v %v", m, e)
	}
	for _, n := range []uint32{0, 524289} {
		b.Reset()
		_ = binary.Write(&b, binary.LittleEndian, n)
		if _, e = readNative(&b); e == nil {
			t.Fatal("accepted invalid frame")
		}
	}
}
func TestHTTPGuards(t *testing.T) {
	r := newRelay(8787, func(any) error { return nil })
	defer r.close()
	for _, tc := range []struct {
		path, host, remote, method, origin, body string
		want                                     int
	}{
		{"/", "localhost:8787", "127.0.0.1:10", "GET", "", "", 200},
		{"/", "attacker.test:8787", "127.0.0.1:10", "GET", "", "", 403},
		{"/", "localhost:8787", "8.8.8.8:10", "GET", "", "", 403},
		{"/setup", "localhost:8787", "192.168.1.5:10", "GET", "", "", 403},
		{"/bridge", "localhost:8787", "127.0.0.1:10", "GET", "", "", 404},
		{"/pair", "localhost:8787", "127.0.0.1:10", "POST", "https://evil.test", `{}`, 403},
		{"/pair", "localhost:8787", "127.0.0.1:10", "POST", "http://localhost:8787", `{"code":"wrong"}`, 401},
		{"/pair", "localhost:8787", "127.0.0.1:10", "POST", "http://localhost:8787", `{"code":"` + r.code + `"}`, 200},
	} {
		q := httptest.NewRequest(tc.method, "http://"+tc.host+tc.path, strings.NewReader(tc.body))
		q.RemoteAddr = tc.remote
		q.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, q)
		if w.Code != tc.want {
			t.Errorf("%s: got %d want %d", tc.path, w.Code, tc.want)
		}
	}
}
func TestRelayCommandsAndIsolation(t *testing.T) {
	commands := make(chan any, 4)
	r := newRelay(0, func(v any) error { commands <- v; return nil })
	srv := httptest.NewServer(r)
	defer srv.Close()
	defer r.close()
	// Use the actual test listener port in Host validation.
	u, _ := url.Parse(srv.URL)
	r.port, _ = strconv.Atoi(u.Port())
	dial := func(key, origin string) (*websocket.Conn, *http.Response, error) {
		return websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws?role=phone&key="+key, http.Header{"Origin": []string{origin}})
	}
	if c, _, e := dial(r.key, "https://evil.test"); e == nil {
		c.Close()
		t.Fatal("accepted bad origin")
	}
	if c, _, e := dial("wrong", srv.URL); e == nil {
		c.Close()
		t.Fatal("accepted wrong key")
	}
	c, _, e := dial(r.key, srv.URL)
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	var m message
	_ = c.ReadJSON(&m)
	_ = c.WriteJSON(map[string]any{"type": "command", "id": "offline", "command": "play"})
	if e = c.ReadJSON(&m); e != nil || field(m, "error") == "" {
		t.Fatal("offline ack missing", e)
	}
	r.receive(message{"type": json.RawMessage(`"state"`), "state": json.RawMessage(`{"ready":true}`), "catalog": json.RawMessage(`[]`)})
	_ = c.ReadJSON(&m)
	_ = c.ReadJSON(&m)
	_ = c.WriteJSON(map[string]any{"type": "command", "id": "one", "command": "skipRecap", "unexpected": "drop"})
	select {
	case v := <-commands:
		cmd := v.(message)
		if field(cmd, "command") != "skipRecap" || cmd["unexpected"] != nil {
			t.Fatal("bad forwarding", cmd)
		}
	case <-time.After(time.Second):
		t.Fatal("command not forwarded")
	}
	r.receive(message{"type": json.RawMessage(`"ack"`), "id": json.RawMessage(`"one"`)})
	if e = c.ReadJSON(&m); e != nil || field(m, "id") != "one" {
		t.Fatal("ack not forwarded", e)
	}
	second, _, e := dial(r.key, srv.URL)
	if e != nil {
		t.Fatal(e)
	}
	defer second.Close()
	if _, _, e = c.ReadMessage(); e == nil {
		t.Fatal("previous phone not closed")
	}
}
