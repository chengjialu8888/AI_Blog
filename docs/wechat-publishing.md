# 微信公众号图片上传与草稿发布

本仓库提供 `scripts/wechat-publish.mjs`，用于把本地 HTML 中的图片上传到微信公众号素材接口、替换为微信 CDN 地址，并按需创建公众号草稿。

> 微信公众号使用的是 `AppID` 和 `AppSecret`。它们常被统称为 API Key，但并不是一段单独的 API Key。

## 能做什么

- 扫描 HTML 中的本地 JPG、JPEG 和 PNG 图片
- 自动压缩超过接口限制的图片，不修改原图
- 上传正文图片并生成微信 CDN 地址
- 输出可直接复制到微信公众号编辑器的 `*-wechat-ready.html`
- 上传封面并调用草稿箱接口创建草稿
- 用 SHA-256 缓存上传结果，重复运行时避免重复传图
- 默认 dry-run，未传 `--execute` 时不会连接微信接口

## 环境要求

- Node.js 18 或更高版本
- 一个具备相关接口权限的微信公众号
- 公众号管理员或获授权的开发者账号
- 调用微信接口的机器拥有可加入白名单的公网出口 IP
- macOS 可使用系统自带的 `sips` 自动压缩图片；其他系统请先自行压缩，或加 `--no-optimize` 在超限时直接报错

## 获取 AppID 和 AppSecret

### 1. 进入微信开发者平台

登录 [微信公众平台](https://mp.weixin.qq.com/)，进入对应公众号，在左侧选择：

```text
设置与开发 -> 开发接口管理
```

自 2025 年 12 月起，开发接口管理已迁移到[微信开发者平台](https://developers.weixin.qq.com/platform)。也可以直接打开开发者平台，用公众号管理员微信扫码登录。

### 2. 选择公众号

在微信开发者平台中进入：

```text
我的业务 -> 公众号/服务号 -> 选择对应公众号 -> 基础信息 -> 开发密钥
```

如果看不到目标公众号，需要公众号管理员在开发者平台为当前微信号配置开发者权限。

### 3. 获取凭证

在“开发密钥”页面找到：

- `开发者ID（AppID）`：对应 `WECHAT_APP_ID`，通常以 `wx` 开头
- `开发者密码（AppSecret）`：对应 `WECHAT_APP_SECRET`

AppSecret 通常不会再次明文显示。忘记后只能由管理员验证并重置，重置会使旧 AppSecret 立即失效。

### 4. 配置 API IP 白名单

在同一页面编辑 `API IP 白名单`，加入运行脚本的服务器公网出口 IP。微信校验的是请求实际到达微信服务器时的出口 IP，不一定等于局域网 IP。

推荐在拥有固定公网 IP 的服务器上运行。公司网络、移动网络、VPN 和部分代理可能使用轮换出口，导致同一台电脑连续请求时出现不同 IP。遇到以下错误时，把错误信息中的 IP 加入白名单，或改用固定出口：

```text
40164 invalid ip x.x.x.x, not in whitelist
```

GitHub 托管 Runner 的出口 IP 可能变化，不适合作为长期白名单来源。CI 发布建议使用自托管 Runner、固定出口代理或部署服务器。

### 5. 检查接口权限

公众号需要具备正文图片上传、永久素材和草稿箱相关接口权限。可在微信开发者平台的“接口管理”中检查权限与调用额度。

## 安全配置

不要把 AppSecret、access token 或真实凭证写进脚本、HTML、文档、聊天记录或 Git 仓库。本仓库已忽略 `.env*` 和 `.wechat-media-cache.json`。

仅在当前终端会话中设置：

```bash
export WECHAT_APP_ID='wx开头的公众号AppID'
export WECHAT_APP_SECRET='公众号AppSecret'
export WECHAT_AUTHOR='可选的默认作者名'
```

也可以传入已有的短期 access token：

```bash
export WECHAT_ACCESS_TOKEN='已有的短期access_token'
```

脚本优先使用 `WECHAT_ACCESS_TOKEN`；未设置时，使用 AppID 和 AppSecret 获取 token。

## 使用方法

### 1. 发布前检查

```bash
node scripts/wechat-publish.mjs \
  --input output/weekly/article.html
```

默认是 dry-run：不会读取凭证、上传图片或创建草稿。它会检查标题、本地图片、缺失文件和需要压缩的图片。

### 2. 上传正文图片

```bash
node scripts/wechat-publish.mjs \
  --input output/weekly/article.html \
  --execute
```

默认输出：

```text
output/weekly/article-wechat-ready.html
```

其中的本地图片地址已经替换为微信 CDN 地址，可以在浏览器中打开并复制到微信公众号编辑器。

### 3. 创建公众号草稿

HTML 需要包含 `<article>` 元素。脚本默认读取 `<title>` 作为草稿标题、`meta[name="description"]` 作为摘要、`meta[property="og:image"]` 作为封面。

```bash
node scripts/wechat-publish.mjs \
  --input output/weekly/article.html \
  --execute \
  --create-draft \
  --source-url 'https://example.com/source'
```

也可以显式覆盖字段：

```bash
node scripts/wechat-publish.mjs \
  --input output/weekly/article.html \
  --execute \
  --create-draft \
  --title '文章标题' \
  --author '作者名' \
  --digest '简短摘要' \
  --thumb-file assets/cover.png
```

创建成功后会输出草稿 `media_id`。脚本只创建草稿，不会自动群发；请在公众号后台预览并完成最终发布。

## 常用参数

| 参数 | 用途 |
| --- | --- |
| `--input <path>` | 源 HTML，必填 |
| `--output <path>` | 指定 CDN 图片版 HTML 的输出路径 |
| `--execute` | 实际连接微信并上传 |
| `--create-draft` | 上传后创建公众号草稿 |
| `--thumb-file <path>` | 指定本地封面图片 |
| `--thumb-media-id <id>` | 复用已有微信封面素材 |
| `--title <text>` | 覆盖草稿标题 |
| `--author <text>` | 覆盖作者名 |
| `--digest <text>` | 覆盖摘要 |
| `--source-url <url>` | 设置原文链接 |
| `--refresh` | 忽略缓存并重新上传 |
| `--no-optimize` | 图片超限时直接报错，不自动压缩 |
| `--keep-dot-labels` | 保留展开的 HTML 点阵标签 |

## 上传缓存

上传结果默认保存在输入 HTML 同目录下的：

```text
.wechat-media-cache.json
```

缓存按图片 SHA-256 复用微信 URL 和封面 `media_id`。它不包含 AppSecret 或 access token，但属于运行产物，默认不提交到 Git。

## 常见错误

### `40164 invalid ip`

当前公网出口 IP 不在微信 API 白名单中。将错误信息中的 IP 加入白名单，或改用固定公网出口。

### `45004 description size out of limit`

摘要过长。使用更短的 `--digest`，例如：

```bash
--digest '这是一条简短、可直接用于公众号卡片的文章摘要。'
```

### 图片上传成功，但草稿创建失败

重新运行同一命令即可。脚本会复用 `.wechat-media-cache.json` 中已上传的图片和封面，不会重复上传；修正标题、摘要、接口权限或白名单后再创建草稿。

### 正文在微信编辑器中没有图片

确认复制的是 `*-wechat-ready.html`，而不是原始 HTML。ready 版本中的图片应使用微信返回的 HTTPS CDN 地址。

## 官方接口

- [上传图文消息正文图片](https://developers.weixin.qq.com/doc/offiaccount/Asset_Management/Adding_Permanent_Assets.html)
- [新增永久素材](https://developers.weixin.qq.com/doc/offiaccount/Asset_Management/Adding_Permanent_Assets.html)
- [新增草稿](https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_draft.html)
