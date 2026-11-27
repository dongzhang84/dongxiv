# 在线后台（https://dongxiv.org/admin/）

在网站上直接发布论文：用 GitHub 登录，上传 PDF，填信息，点"发布"。功能和本地后台（`npm run admin`）一样，区别是每次点"发布"就直接提交到 GitHub，不先暂存。Vercel 看到新提交后自动重新构建，大约一两分钟后上线。后台页面会显示上线进度。

网站顶栏的 **Submit** 按钮只在登录过后台的浏览器里显示。其他浏览器直接打开 `/admin/` 就行。

## 一次性设置（约 5 分钟）

### 1. 建一个 GitHub App

打开 <https://github.com/settings/apps/new>，填写：

| 项 | 填写 |
|---|---|
| GitHub App name | `dongxiv-admin`（必须全 GitHub 唯一，被占用就换一个） |
| Homepage URL | `https://dongxiv.org` |
| Callback URL | `https://dongxiv.org/api/auth/callback` |
| Expire user authorization tokens | 保持勾选（令牌 8 小时后失效） |
| Request user authorization (OAuth) during installation | 不勾 |
| Webhook → Active | **取消勾选** |
| Repository permissions → Contents | **Read and write** |
| 其他权限 | 都不用开 |
| Where can this GitHub App be installed? | Only on this account |

点 **Create GitHub App**。在新页面上：

- 记下 **Client ID**；
- 点 **Generate a new client secret**，记下生成的 secret（只显示一次）。

### 2. 只装到 dongxiv 仓库

在这个 App 的页面左侧点 **Install App** → 你的账号旁边的 **Install** → 选 **Only select repositories** → 选 `dongxiv` → Install。

### 3. 在 Vercel 填两个环境变量

Vercel → dongxiv 项目 → Settings → Environment Variables，添加：

| Name | Value |
|---|---|
| `GITHUB_CLIENT_ID` | 第 1 步的 Client ID |
| `GITHUB_CLIENT_SECRET` | 第 1 步的 client secret |

然后在 Deployments 里对最新一次部署点 **Redeploy**，环境变量才会生效。

### 4. 试一下

打开 <https://dongxiv.org/admin/>，点"用 GitHub 登录"，授权。看到论文列表就设置好了。

## 安全设计

- 只有 GitHub 账号 `dongzhang84`（取自 `site.config.mjs` 的 `repoUrl`）能登录；其他人登录会被拒绝，而且他们本来也没有这个仓库的写权限。
- 登录得到的令牌来自上面的 GitHub App，只能读写 `dongxiv` 这一个仓库，8 小时后失效，只存在这个浏览器的 cookie 里（路径限定 `/admin/`）。服务器不保存任何令牌。
- PDF 由浏览器直接传给 GitHub，不经过 Vercel，所以不受 Vercel 4.5 MB 请求大小的限制（GitHub 单文件上限 100 MB）。
- 每次提交都基于读取时的最新 commit；如果期间仓库被别处改过（比如本地后台刚发布），GitHub 会拒绝，不会覆盖。
- 构建时照常校验所有 PDF 的 SHA-256；校验失败则这次部署失败，网站保持原样。
- 已发布的 PDF 不能替换或删除，只能发新版本。

## 代码

- `src/pages/admin/index.astro`：后台页面
- `src/admin/`：界面（`app.js`）、GitHub 读写（`github.js`）、表单校验和编号（`meta.js`）、PDF 自动提取（`pdf.js`，用 pdf.js 在浏览器里读）
- `src/pages/api/auth/login.ts`、`callback.ts`：GitHub 登录，在 Vercel 上按需运行（其余页面都是静态的）
- `src/pages/version.json.ts`：线上版本对应的 commit，后台用它判断是否已上线
