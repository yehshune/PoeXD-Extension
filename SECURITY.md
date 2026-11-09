# Security Policy / 安全性政策

## Supported versions / 支援版本

Only the latest release receives security fixes. / 只有最新發布的版本會收到安全性修正。

## Reporting a vulnerability / 回報漏洞

**Please do not open a public issue for security problems.** Use GitHub's
[private vulnerability reporting](https://github.com/yehshune/PoeXD-Extension/security/advisories/new)
instead.

**請勿以公開 Issue 回報安全性問題**，請改用 GitHub 的
[私下回報漏洞](https://github.com/yehshune/PoeXD-Extension/security/advisories/new)功能。

Please include / 請附上：

- Affected version and browser / 受影響的版本與瀏覽器
- Steps to reproduce or a proof of concept / 重現步驟或概念驗證
- Impact you expect / 你評估的影響

You should receive an initial response within 7 days. / 通常會在 7 天內初步回覆。

## Scope / 範圍

Areas of particular interest / 特別關注的範圍：

- Messages between the trade page, content scripts and the background worker /
  交易頁面、內容腳本與背景服務之間的訊息傳遞
- Injection of untrusted text into the trade page DOM / 不受信任的文字注入交易頁面 DOM

Vulnerabilities in the official trade site, desktop applications from third parties, or the browser
itself are out of scope. / 官方交易網站、第三方桌面應用程式或瀏覽器本身的漏洞不在範圍內。
