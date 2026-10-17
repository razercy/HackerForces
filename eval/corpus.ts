// SYNTHETIC DATA ONLY: example solutions and reusable templates for the
// evaluation scenarios. Written for this project; not taken from any contest.

export const TEMPLATES = {
  fastio: `#include <bits/stdc++.h>
using namespace std;
using ll = long long;
#define all(x) (x).begin(), (x).end()
`,
  dsu: `struct DSU {
    vector<int> p, sz;
    DSU(int n) : p(n), sz(n, 1) { iota(p.begin(), p.end(), 0); }
    int find(int x) { return p[x] == x ? x : p[x] = find(p[x]); }
    bool unite(int a, int b) {
        a = find(a); b = find(b);
        if (a == b) return false;
        if (sz[a] < sz[b]) swap(a, b);
        p[b] = a; sz[a] += sz[b];
        return true;
    }
};
`,
  segtree: `struct SegTree {
    int n; vector<long long> t;
    SegTree(int n) : n(n), t(2 * n, 0) {}
    void update(int i, long long v) {
        for (t[i += n] = v; i > 1; i >>= 1) t[i >> 1] = t[i] + t[i ^ 1];
    }
    long long query(int l, int r) {
        long long res = 0;
        for (l += n, r += n; l < r; l >>= 1, r >>= 1) {
            if (l & 1) res += t[l++];
            if (r & 1) res += t[--r];
        }
        return res;
    }
};
`,
  modpow: `const long long MOD = 1'000'000'007LL;
long long power(long long b, long long e) {
    long long r = 1; b %= MOD;
    while (e > 0) { if (e & 1) r = r * b % MOD; b = b * b % MOD; e >>= 1; }
    return r;
}
`,
} as const;
export type TemplateName = keyof typeof TEMPLATES;

export type Problem = {
  id: string;
  difficulty: number;
  /** Templates the reference-style solution uses, in order. */
  uses: TemplateName[];
  /** Problem-specific code typed after the templates. */
  body: string;
};

export const PROBLEMS: Problem[] = [
  {
    id: "p-sum",
    difficulty: 800,
    uses: ["fastio"],
    body: `int main() {
    ll a, b;
    cin >> a >> b;
    cout << a + b << "\\n";
}
`,
  },
  {
    id: "p-kadane",
    difficulty: 1200,
    uses: ["fastio"],
    body: `int main() {
    ios::sync_with_stdio(false); cin.tie(nullptr);
    int n; cin >> n;
    vector<ll> a(n);
    for (auto &x : a) cin >> x;
    ll best = LLONG_MIN, cur = 0;
    for (ll x : a) {
        cur = max(x, cur + x);
        best = max(best, cur);
    }
    cout << best << "\\n";
}
`,
  },
  {
    id: "p-components",
    difficulty: 1500,
    uses: ["fastio", "dsu"],
    body: `int main() {
    ios::sync_with_stdio(false); cin.tie(nullptr);
    int n, m; cin >> n >> m;
    DSU d(n);
    int comps = n;
    for (int i = 0; i < m; i++) {
        int u, v; cin >> u >> v; --u; --v;
        if (d.unite(u, v)) comps--;
    }
    cout << comps << "\\n";
}
`,
  },
  {
    id: "p-rangesum",
    difficulty: 1700,
    uses: ["fastio", "segtree"],
    body: `int main() {
    ios::sync_with_stdio(false); cin.tie(nullptr);
    int n, q; cin >> n >> q;
    SegTree st(n);
    for (int i = 0; i < n; i++) { long long x; cin >> x; st.update(i, x); }
    while (q--) {
        int type; cin >> type;
        if (type == 1) { int i; long long v; cin >> i >> v; st.update(i - 1, v); }
        else { int l, r; cin >> l >> r; cout << st.query(l - 1, r) << "\\n"; }
    }
}
`,
  },
  {
    id: "p-modcount",
    difficulty: 1900,
    uses: ["fastio", "modpow"],
    body: `int main() {
    ios::sync_with_stdio(false); cin.tie(nullptr);
    int n; cin >> n;
    vector<long long> fact(n + 1, 1), inv(n + 1, 1);
    for (int i = 1; i <= n; i++) fact[i] = fact[i - 1] * i % MOD;
    inv[n] = power(fact[n], MOD - 2);
    for (int i = n; i > 0; i--) inv[i - 1] = inv[i] * i % MOD;
    auto C = [&](int a, int b) { return b < 0 || b > a ? 0LL : fact[a] * inv[b] % MOD * inv[a - b] % MOD; };
    long long ans = 0;
    for (int k = 0; k <= n; k++) ans = (ans + C(n, k) * power(2, k)) % MOD;
    cout << ans << "\\n";
}
`,
  },
  {
    id: "p-shortest",
    difficulty: 2100,
    uses: ["fastio"],
    body: `int main() {
    ios::sync_with_stdio(false); cin.tie(nullptr);
    int n, m; cin >> n >> m;
    vector<vector<pair<int, ll>>> g(n);
    for (int i = 0; i < m; i++) {
        int u, v; ll w; cin >> u >> v >> w; --u; --v;
        g[u].push_back({v, w}); g[v].push_back({u, w});
    }
    vector<ll> dist(n, LLONG_MAX);
    priority_queue<pair<ll, int>, vector<pair<ll, int>>, greater<>> pq;
    dist[0] = 0; pq.push({0, 0});
    while (!pq.empty()) {
        auto [d, u] = pq.top(); pq.pop();
        if (d != dist[u]) continue;
        for (auto [v, w] : g[u]) {
            if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; pq.push({dist[v], v}); }
        }
    }
    for (int i = 0; i < n; i++) cout << (dist[i] == LLONG_MAX ? -1 : dist[i]) << " \\n"[i + 1 == n];
}
`,
  },
];

export const solutionOf = (p: Problem) => p.uses.map((t) => TEMPLATES[t]).join("\n") + "\n" + p.body;
