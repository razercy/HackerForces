// The synthetic timeline builder lives in eval/ (shared with the evaluation generator).
export { TimelineBuilder, rng, sha, submissionFrom } from "../../eval/builder";

export const SOLUTION = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    cin >> n;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;
    sort(a.begin(), a.end());
    long long best = 0, run = 0;
    for (int i = 0; i < n; i++) {
        run = max(0LL, run + a[i]);
        best = max(best, run);
    }
    cout << best << "\\n";
    return 0;
}
`;
