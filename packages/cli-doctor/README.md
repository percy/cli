# @percy/cli-doctor

> Percy CLI sub-command that diagnoses network readiness for running Percy builds.

---

## Installation

`@percy/cli-doctor` is bundled with `@percy/cli`. If you use the Percy CLI you already have it:

```sh
npx percy doctor
```

To install standalone:

```sh
npm install --save-dev @percy/cli-doctor
# or
yarn add --dev @percy/cli-doctor
```

---

## Usage

```
percy doctor [options]

Options:
  --proxy-server  <url>   Proxy server to test alongside direct connectivity
                          e.g. http://proxy.corp.example.com:8080
  --url           <url>   URL to open in Chrome for network activity analysis
                          (default: https://percy.io)
  --timeout       <ms>    Per-request timeout in milliseconds (default: 10000)
  --output-json   <path>  Write the full diagnostic report to a JSON file
  -v, --verbose           Show detailed debug output
  -h, --help              Show help
```

---

## What it checks

### 1 · Network Connectivity

Probes each required Percy / BrowserStack domain:

| Domain | Purpose |
|---|---|
| `https://percy.io` | Percy API |
| `https://www.browserstack.com` | BrowserStack API |
| `https://hub.browserstack.com` | BrowserStack Automate |

Failure modes are classified as:

* **ENOTFOUND** → DNS resolution failure; suggest whitelisting on corporate DNS
* **ETIMEDOUT / ECONNRESET** → Firewall dropping packets; list CIDRs to whitelist
* **via proxy only** → Proxy required, suggests setting `HTTPS_PROXY`

### 2 · SSL / TLS

| Scenario | Outcome |
|---|---|
| `NODE_TLS_REJECT_UNAUTHORIZED=0` is set | **Warning** – SSL verification is disabled globally |
| SSL certificate error connecting to percy.io | **Fail** – likely a MITM proxy/VPN; suggests remediation |
| SSL handshake succeeds | **Pass** |

When a certificate error is detected, the command prints actionable suggestions
(contact network admin, add proxy cert to trust store, set `NODE_EXTRA_CA_CERTS`).

### 3 · Proxy Detection

Detects proxy configuration from (in priority order):

1. **Environment variables**: `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`
2. **macOS system proxy**: `scutil --proxy`, `networksetup -getautoproxyurl`
3. **Linux (GNOME)**: `gsettings org.gnome.system.proxy`
4. **Linux (/etc)**: `/etc/environment`
5. **Windows registry**: `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`

Each discovered proxy is validated by attempting connections to percy.io and
browserstack.com through it.

### 4 · PAC / WPAD Auto-Proxy Configuration

Detects PAC file URLs from:

| Source | Detection method |
|---|---|
| macOS system | `networksetup -getautoproxyurl <interface>` |
| macOS plist | `/Library/Preferences/SystemConfiguration/preferences.plist` |
| Linux GNOME | `gsettings org.gnome.system.proxy autoconfig-url` |
| Windows | `HKCU\…\Internet Settings\AutoConfigURL` |
| Chrome / Chromium | `Default/Preferences` JSON (macOS, Linux, Windows) |
| Firefox | `~/.mozilla/firefox/*/prefs.js` (network.proxy.autoconfig_url) |

The PAC script is fetched and evaluated in a sandboxed Node.js `vm` context
using shims for all standard PAC helper functions. The result of
`FindProxyForURL("https://percy.io/", "percy.io")` is reported.

If a PAC file routes percy.io through a proxy the command surfaces the exact
`HTTPS_PROXY=…` export statement to add to your CI environment.

---

## Example output

```
  Percy Doctor — network readiness check

── SSL / TLS
  ✔ SSL handshake with percy.io succeeded (47ms).

── Network Connectivity
  ✔ Percy API is reachable directly (HTTP 200, 51ms).
  ✔ BrowserStack API is reachable directly (HTTP 200, 72ms).
  ✔ BrowserStack Automate is reachable directly (HTTP 200, 89ms).

── Proxy Configuration
  ℹ No proxy configuration detected in environment or system settings.

── PAC / Auto-Proxy Configuration
  ℹ No PAC (Proxy Auto-Configuration) file detected.

✔ All 6 checks passed
```

---

## License

MIT
