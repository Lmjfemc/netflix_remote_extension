package main

import (
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	qrcode "github.com/skip2/go-qrcode"
)

//go:embed public/*
var assets embed.FS

type message map[string]json.RawMessage

func field(m message, k string) string { var s string; _ = json.Unmarshal(m[k], &s); return s }
func token() string {
	b := make([]byte, 24)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func equal(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
func private(ip net.IP) bool { return ip != nil && (ip.IsPrivate() || ip.IsLoopback()) }
func remoteIP(r *http.Request) net.IP {
	h, _, _ := net.SplitHostPort(r.RemoteAddr)
	return net.ParseIP(h)
}

type attempt struct {
	count int
	since time.Time
}
type peer struct {
	ws *websocket.Conn
	mu sync.Mutex
}

func (p *peer) send(v any) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	_ = p.ws.SetWriteDeadline(time.Now().Add(2 * time.Second))
	_ = p.ws.WriteJSON(v)
}

type relay struct {
	mu             sync.Mutex
	port           int
	addresses      []string
	listAddrs      func() []string
	refreshed      time.Time
	addressesDirty bool
	initializing   bool
	code, key      string
	phone          *peer
	state          message
	catalog        message
	last           time.Time
	pending        map[string]*time.Timer
	attempts       map[string]attempt
	native         func(any) error
	done           chan struct{}
	once           sync.Once
}

func newCode() string {
	n, e := rand.Int(rand.Reader, big.NewInt(900000))
	if e != nil {
		panic(e)
	}
	return fmt.Sprint(n.Int64() + 100000)
}
func newRelay(port int, native func(any) error) *relay {
	r := &relay{port: port, code: newCode(), key: token(), pending: map[string]*time.Timer{}, attempts: map[string]attempt{}, native: native, done: make(chan struct{}), listAddrs: lanAddresses}
	r.refreshAddresses()
	return r
}

// resume adopts the session key issued by an earlier run of the helper, so a
// phone paired before a restart keeps working without a new code. Only a
// well-formed key (48 hex chars, as token() produces) is accepted.
func (r *relay) resume(key string) bool {
	if len(key) != 48 {
		return false
	}
	if _, e := hex.DecodeString(key); e != nil {
		return false
	}
	r.key = key
	return true
}

// attemptsFor returns the failure window for ip, starting a fresh minute when
// the previous one has expired. Caller holds r.mu.
func (r *relay) attemptsFor(ip string) attempt {
	a := r.attempts[ip]
	if time.Since(a.since) > time.Minute {
		a = attempt{since: time.Now()}
	}
	return a
}

// kick closes the current phone with a WebSocket close code and reason.
// Caller holds r.mu.
func (r *relay) kick(code int, reason string) {
	if r.phone == nil {
		return
	}
	_ = r.phone.ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(code, reason), time.Now().Add(time.Second))
	_ = r.phone.ws.Close()
	r.phone = nil
	r.clearPending()
}

// lanAddresses lists the private IPv4 addresses a phone could reach us on.
func lanAddresses() []string {
	var out []string
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		ip, _, _ := net.ParseCIDR(a.String())
		if ip != nil && ip.To4() != nil && !ip.IsLoopback() && ip.IsPrivate() {
			out = append(out, ip.String())
		}
	}
	return out
}

// refreshAddresses re-reads the interface list and reports whether it changed.
// The list used to be captured once at startup, so a PC that moved to another
// Wi-Fi kept rejecting its own new address in the Host check until a restart.
// Caller holds r.mu.
func (r *relay) refreshAddresses() bool {
	r.refreshed = time.Now()
	next := r.listAddrs()
	if slices.Equal(next, r.addresses) {
		return false
	}
	r.addresses = next
	r.addressesDirty = true
	return true
}

// Collection can happen in validHost as well as the ticker. Only delivery
// consumes this flag, so an HTTP request cannot swallow the popup update.
func (r *relay) addressUpdate() any {
	r.refreshAddresses()
	if !r.addressesDirty || r.initializing {
		return nil
	}
	r.addressesDirty = false
	return r.ready()
}
func (r *relay) hostKnown(h string) bool {
	for _, a := range append([]string{"localhost", "127.0.0.1"}, r.addresses...) {
		if h == net.JoinHostPort(a, fmt.Sprint(r.port)) {
			return true
		}
	}
	return false
}

// validHost accepts loopback and any current LAN address. An unknown host
// triggers at most one interface re-scan per second, so an address change is
// picked up by the first request that uses it instead of needing a restart.
func (r *relay) validHost(h string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.hostKnown(h) {
		return true
	}
	if time.Since(r.refreshed) < time.Second || !r.refreshAddresses() {
		return false
	}
	return r.hostKnown(h)
}
func (r *relay) status() any {
	return map[string]any{"type": "status", "pc": !r.last.IsZero() && time.Since(r.last) < 6*time.Second}
}
func (r *relay) setup() map[string]any {
	links := []string{}
	for _, a := range r.addresses {
		links = append(links, fmt.Sprintf("http://%s:%d/#code=%s", a, r.port, r.code))
	}
	if len(links) == 0 {
		links = append(links, fmt.Sprintf("http://127.0.0.1:%d/#code=%s", r.port, r.code))
	}
	png, _ := qrcode.Encode(links[0], qrcode.Medium, 256)
	return map[string]any{"type": "ready", "code": r.code, "links": links, "qr": "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), "pc": !r.last.IsZero() && time.Since(r.last) < 6*time.Second, "port": r.port}
}

// ready is the Native Messaging variant of setup: it also carries the session
// key so the extension can hand it back through "hello" after a restart. The
// HTTP /setup endpoint never exposes the key.
func (r *relay) ready() map[string]any {
	v := r.setup()
	v["key"] = r.key
	return v
}
func jsonResponse(w http.ResponseWriter, v any, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func (r *relay) ServeHTTP(w http.ResponseWriter, q *http.Request) {
	if !private(remoteIP(q)) || !r.validHost(q.Host) {
		http.Error(w, "Forbidden", 403)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if q.URL.Path == "/session" || q.URL.Path == "/pair" || q.URL.Path == "/setup" || q.URL.Path == "/ws" {
		r.mu.Lock()
		initializing := r.initializing
		r.mu.Unlock()
		if initializing {
			w.Header().Set("Retry-After", "1")
			jsonResponse(w, map[string]string{"error": "Pairing is being restored. Retry shortly."}, 503)
			return
		}
	}
	switch q.URL.Path {
	case "/setup":
		if !remoteIP(q).IsLoopback() {
			http.Error(w, "PC only", 403)
			return
		}
		r.mu.Lock()
		v := r.setup()
		r.mu.Unlock()
		jsonResponse(w, v, 200)
		return
	case "/pair":
		if q.Method != "POST" || q.Header.Get("Origin") != "http://"+q.Host {
			http.Error(w, "Forbidden", 403)
			return
		}
		r.mu.Lock()
		defer r.mu.Unlock()
		ip := remoteIP(q).String()
		a := r.attemptsFor(ip)
		a.count++
		r.attempts[ip] = a
		if a.count > 10 {
			jsonResponse(w, map[string]string{"error": "Too many attempts. Wait a minute."}, 429)
			return
		}
		var b struct {
			Code string `json:"code"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, q.Body, 256)).Decode(&b) != nil {
			http.Error(w, "Bad request", 400)
			return
		}
		if !equal(b.Code, r.code) {
			jsonResponse(w, map[string]string{"error": "Pairing code does not match."}, 401)
			return
		}
		jsonResponse(w, map[string]string{"key": r.key}, 200)
		return
	case "/session":
		// A phone that kept its key from an earlier pairing checks it here before
		// opening the WebSocket: a rejected upgrade gives browser JS no status
		// code, so this is what tells "PC is off" from "pairing was reset".
		if q.Method != "POST" || q.Header.Get("Origin") != "http://"+q.Host {
			http.Error(w, "Forbidden", 403)
			return
		}
		r.mu.Lock()
		defer r.mu.Unlock()
		ip := remoteIP(q).String()
		a := r.attemptsFor(ip)
		if a.count > 10 {
			jsonResponse(w, map[string]string{"error": "Too many attempts. Wait a minute."}, 429)
			return
		}
		var b struct {
			Key string `json:"key"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, q.Body, 256)).Decode(&b) != nil {
			http.Error(w, "Bad request", 400)
			return
		}
		if !equal(b.Key, r.key) {
			// Only mismatches count toward the limit: a valid phone re-checks
			// after every reconnect and must not lock itself out.
			a.count++
			r.attempts[ip] = a
			jsonResponse(w, map[string]string{"error": "Pairing was reset on the PC. Enter the new code."}, 401)
			return
		}
		w.WriteHeader(204)
		return
	case "/ws":
		r.socket(w, q)
		return
	}
	if q.Method != "GET" && q.Method != "HEAD" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	files := map[string]string{"/": "index.html", "/app.js": "app.js", "/style.css": "style.css", "/manifest.webmanifest": "manifest.webmanifest", "/icon.svg": "icon.svg", "/pc": "pc.html", "/pc.js": "pc.js"}
	f, ok := files[q.URL.Path]
	if !ok {
		http.NotFound(w, q)
		return
	}
	b, e := assets.ReadFile("public/" + f)
	if e != nil {
		http.Error(w, "Missing asset", 500)
		return
	}
	ct := "text/html; charset=utf-8"
	if strings.HasSuffix(f, ".js") {
		ct = "text/javascript"
	} else if strings.HasSuffix(f, ".css") {
		ct = "text/css"
	} else if strings.HasSuffix(f, ".svg") {
		ct = "image/svg+xml"
	} else if strings.HasSuffix(f, ".webmanifest") {
		ct = "application/manifest+json"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.nflxso.net https://*.nflximg.net; connect-src 'self'; frame-ancestors 'none'")
	if q.Method == "GET" {
		_, _ = w.Write(b)
	}
}

var allowed = map[string]bool{"play": true, "pause": true, "seek": true, "seekBy": true, "volume": true, "mute": true, "fullscreen": true, "skipIntro": true, "skipRecap": true, "next": true, "autoSkip": true, "select": true, "search": true, "browse": true}

func (r *relay) socket(w http.ResponseWriter, q *http.Request) {
	key := q.URL.Query().Get("key")
	r.mu.Lock()
	valid := !r.initializing && equal(key, r.key)
	r.mu.Unlock()
	if q.URL.Query().Get("role") != "phone" || !valid || q.Header.Get("Origin") != "http://"+q.Host {
		http.Error(w, "Forbidden", 403)
		return
	}
	up := websocket.Upgrader{CheckOrigin: func(q *http.Request) bool { return q.Header.Get("Origin") == "http://"+q.Host }}
	ws, e := up.Upgrade(w, q, nil)
	if e != nil {
		return
	}
	p := &peer{ws: ws}
	ws.SetReadLimit(8192)
	r.mu.Lock()
	// Reset may have run while Upgrade was in flight. Never register a peer
	// authenticated with a key that has since been revoked.
	if r.initializing || !equal(key, r.key) {
		r.mu.Unlock()
		_ = ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(4002, "Pairing was reset on the PC"), time.Now().Add(time.Second))
		_ = ws.Close()
		return
	}
	r.kick(4001, "Another phone connected")
	r.phone = p
	p.send(r.status())
	if r.state != nil {
		p.send(r.state)
	}
	if r.catalog != nil {
		p.send(r.catalog)
	}
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		if r.phone == p {
			r.phone = nil
			r.clearPending()
		}
		r.mu.Unlock()
		_ = ws.Close()
	}()
	for {
		var m message
		if ws.ReadJSON(&m) != nil {
			return
		}
		r.mu.Lock()
		if r.phone != p {
			r.mu.Unlock()
			return
		}
		id := field(m, "id")
		if field(m, "type") != "command" || !allowed[field(m, "command")] || id == "" || len(id) > 100 {
			r.mu.Unlock()
			continue
		}
		if r.last.IsZero() || time.Since(r.last) >= 6*time.Second {
			p.send(map[string]string{"type": "ack", "id": id, "error": "Netflix is disconnected."})
			r.mu.Unlock()
			continue
		}
		if len(r.pending) >= 20 || r.pending[id] != nil {
			r.mu.Unlock()
			continue
		}
		r.pending[id] = time.AfterFunc(8*time.Second, func() {
			r.mu.Lock()
			defer r.mu.Unlock()
			if _, ok := r.pending[id]; ok {
				delete(r.pending, id)
				p.send(map[string]string{"type": "ack", "id": id, "error": "No response from Netflix. Try again."})
			}
		})
		// Only the documented fields cross the native host boundary.
		clean := message{"type": m["type"], "id": m["id"], "command": m["command"]}
		if v, ok := m["value"]; ok {
			clean["value"] = v
		}
		err := r.native(clean)
		r.mu.Unlock()
		if err != nil {
			return
		}
	}
}
func (r *relay) clearPending() {
	for id, t := range r.pending {
		t.Stop()
		delete(r.pending, id)
	}
}

// receive handles a message from the extension. A non-nil reply is sent back
// over Native Messaging by the caller, outside the lock.
func (r *relay) receive(m message) (reply any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	switch field(m, "type") {
	case "hello":
		// First message after the extension connects, optionally carrying the
		// key from the previous helper run. Answered with the (possibly
		// resumed) pairing data; authentication is now available.
		r.resume(field(m, "key"))
		r.initializing = false
		r.addressesDirty = false
		return r.ready()
	case "rotate":
		// The user asked for a fresh pairing: new key and code, current phone
		// is disconnected with a code that tells it to ask for the new code.
		r.key, r.code = token(), newCode()
		r.kick(4002, "Pairing was reset on the PC")
		return r.ready()
	case "state":
		if len(m["state"]) == 0 {
			return nil
		}
		r.last = time.Now()
		r.state = m
		r.phone.send(m)
		r.phone.send(r.status())
	case "catalog":
		// The extension sends this only when the card list changes, so it is
		// kept apart from the state heartbeat and replayed to each new phone.
		if len(m["catalog"]) == 0 {
			return nil
		}
		r.catalog = m
		r.phone.send(m)
	case "ack":
		id := field(m, "id")
		if t := r.pending[id]; t != nil {
			t.Stop()
			delete(r.pending, id)
			r.phone.send(m)
		}
	}
	return nil
}
func (r *relay) close() {
	r.once.Do(func() {
		close(r.done)
		r.mu.Lock()
		defer r.mu.Unlock()
		r.clearPending()
		if r.phone != nil {
			_ = r.phone.ws.Close()
		}
	})
}
func readNative(rd io.Reader) (message, error) {
	var n uint32
	if e := binary.Read(rd, binary.LittleEndian, &n); e != nil {
		return nil, e
	}
	if n == 0 || n > 512*1024 {
		return nil, fmt.Errorf("invalid native frame size: %d", n)
	}
	b := make([]byte, n)
	if _, e := io.ReadFull(rd, b); e != nil {
		return nil, e
	}
	var m message
	e := json.Unmarshal(b, &m)
	return m, e
}
func writeNative(w io.Writer, v any) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	if len(b) > 1024*1024 {
		return fmt.Errorf("native frame too large")
	}
	frame := make([]byte, 4+len(b))
	binary.LittleEndian.PutUint32(frame, uint32(len(b)))
	copy(frame[4:], b)
	_, e = w.Write(frame)
	return e
}
func main() {
	serve := flag.Bool("serve", false, "Run standalone for diagnostics; Netflix requires Native Messaging")
	port := flag.Int("port", 8787, "LAN port")
	flag.Parse()
	log.SetOutput(os.Stderr)
	var out sync.Mutex
	send := func(v any) error {
		out.Lock()
		defer out.Unlock()
		if *serve {
			return nil
		}
		return writeNative(os.Stdout, v)
	}
	r := newRelay(*port, send)
	r.initializing = !*serve
	ln, e := net.Listen("tcp4", fmt.Sprintf("0.0.0.0:%d", *port))
	if e != nil {
		_ = send(map[string]string{"type": "error", "error": "Cannot start LAN server: " + e.Error()})
		log.Print(e)
		return
	}
	r.port = ln.Addr().(*net.TCPAddr).Port
	srv := &http.Server{Handler: r, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	go func() {
		if e := srv.Serve(ln); e != nil && e != http.ErrServerClosed {
			log.Print(e)
			r.close()
		}
	}()
	if *serve {
		log.Printf("PC pairing: http://localhost:%d/pc", r.port)
	} else {
		go func() {
			defer r.close()
			for {
				m, e := readNative(os.Stdin)
				if e != nil {
					return
				}
				if field(m, "type") == "stop" {
					return
				}
				if v := r.receive(m); v != nil && send(v) != nil {
					return
				}
			}
		}()
		// Authentication remains unavailable until hello restores the key.
		// Do not publish a temporary key on a timeout: a slow storage read must
		// not replace a valid persisted pairing. Extension and host upgrade together.
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.done:
			_ = srv.Close()
			return
		case <-sig:
			r.close()
		case <-ticker.C:
			r.mu.Lock()
			r.phone.send(r.status())
			for ip, a := range r.attempts {
				if time.Since(a.since) > time.Minute {
					delete(r.attempts, ip)
				}
			}
			fresh := r.addressUpdate()
			r.mu.Unlock()
			if fresh != nil {
				_ = send(fresh)
			}
		}
	}
}
