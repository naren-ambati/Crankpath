import { describe, expect, it } from "vitest";
import { guardChartUrl } from "../../src/u4-render-engine/url-guard.js";

describe("URL guard for chart repositories (FR1.8, BR4.11, BR4.20)", () => {
  it.each([
    ["https://charts.example.org", "https://charts.example.org", "https"],
    ["https://Charts.Example.org/stable/", "https://charts.example.org/stable", "https"],
    ["oci://registry.example.org/charts", "oci://registry.example.org/charts", "oci"],
    ["https://charts.example.org:8443/x", "https://charts.example.org:8443/x", "https"],
  ])("accepts %s", (raw, url, scheme) => {
    expect(guardChartUrl(raw)).toMatchObject({ ok: true, url, scheme });
  });
  it.each([
    ["http://charts.example.org", "scheme"],
    ["git@github.com:org/repo", "scheme"],
    ["file:///etc", "scheme"],
    ["registry.example.org/charts", "scheme"],
    ["https://127.0.0.1/charts", "ip-literal"],
    ["https://0x7f.1/charts", "ip-literal"],
    ["https://2130706433/charts", "ip-literal"],
    ["oci://10.0.0.1/charts", "ip-literal"],
    ["https://[::1]/charts", "ip-literal"],
    ["https://169.254.169.254/latest", "ip-literal"],
    ["https://localhost/charts", "loopback"],
    ["https://x.localhost/charts", "loopback"],
    ["https://printer.local/charts", "loopback"],
    ["https://user:pass@charts.example.org", "credential"],
    ["https://token@charts.example.org", "credential"],
    ["https://@charts.example.org", "credential"],
    ["https://charts.example.org/?a=b", "query"],
    ["https://charts.example.org/#x", "query"],
    ["https://charts.example.org/a b", "unparseable"],
    ["https://charts.example.org/\x1b[2J", "unparseable"],
    ["", "unparseable"],
  ])("refuses %j (%s)", (raw, problem) => {
    expect(guardChartUrl(raw)).toEqual({ ok: false, problem });
  });
});
