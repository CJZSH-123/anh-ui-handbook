# 上线与跨设备同步

这个项目是纯静态网页，不需要构建。**托管到 Vercel 后还能额外获得「同步码」跨设备同步书签**。

---

## 一、先把代码传到 GitHub

本地已经有提交（分支 `main`），仓库地址是 `https://github.com/CJZSH-123/anh-ui-handbook`。

**以后更新内容**：改完文件后双击项目根目录的 `push-to-github.cmd`，
它会自动提交、启动网络隧道并推送。第一次运行需要粘贴一次 GitHub 令牌，
之后会记住在 `token.txt`（不会上传）。

如果是在别的机器上，或者想手动推送：

```
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

推送时会要求登录 GitHub，按提示授权即可。

---

## 二、部署到 Vercel

1. 打开 https://vercel.com ，用 GitHub 账号登录
2. **Add New → Project**，选中刚推上去的仓库
3. Framework Preset 选 **Other**，Build Command 和 Output Directory 都留空
4. 点 **Deploy**，大约半分钟就有网址，形如 `https://你的项目名.vercel.app`

到这里网页就能用了，但「跨设备同步」还不可用——因为它需要一个存储。做完下一步才有。

---

## 三、开启跨设备同步（可选，但推荐）

同步用的是 Upstash Redis，Vercel 市场里可以一键接入，有免费额度。

1. Vercel 项目页面 → **Storage** → **Create Database** → 选 **Upstash Redis**（或 Vercel KV）
2. 创建时选择 **Connect to Project**，指向这个项目
3. 接好后 Vercel 会自动注入环境变量（`KV_REST_API_URL` / `KV_REST_API_TOKEN`，
   或 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`，两种命名代码都认）
4. **Redeploy** 一次（Deployments → 最新一条 → Redeploy），让环境变量生效

完成后打开网页，左侧「书签」页签里会出现「跨设备同步」：点「开启同步」得到一串 12 位同步码，
在手机、别的浏览器里输入同一个码，书签就互通了。

**关于隐私**：同步只上传书签的**名字、段落位置和一句指纹**，不含手册正文，也不含任何账号信息。
同步码本身就是凭证，等于密码，别公开发出去。

---

## 四、本地想先试同步

不用部署也能在本地把流程走一遍，仓库里带了一个内存版假后端（进程重启数据就没了，仅供测试）：

```
node tools/mock-sync-server.js 5181
```

然后浏览器打开 http://127.0.0.1:5181 ，同步功能就是可用的。

---

## 五、也可以只用 GitHub Pages（但没有同步）

如果不需要跨设备同步，GitHub Pages 更省事：

1. 仓库 **Settings → Pages**
2. Source 选 `Deploy from a branch`，Branch 选 `main`、目录 `/ (root)`，保存
3. 等 1～2 分钟，得到 `https://你的用户名.github.io/仓库名/`

Pages 只能托管静态文件，跑不了 `api/sync`，所以页面里同步区会显示"服务未启用"，
其它功能（检索、目录、书签、导出备份）都正常。

---

## 六、以后改内容

改完 `source/toc.txt` 或 `source/supplements/` 之后：

```
python tools/build_data.py       # 重建正文与目录
python tools/build_single.py     # 重新打包手机单文件版
git add -A
git commit -m "更新手册内容"
git push
```

Vercel 会自动重新部署，GitHub Pages 同理。

---

## 附：文件说明

- `dist/学生手册查询.html`：单文件版，会一起发布，别人可直接下载到手机上离线用
  （单文件版里跨设备同步不可用，因为脱离了服务器）
- `source/handbook-original.doc`：原始扫描件，已在 `.gitignore` 中排除，不会上传；
  想一起传就把 `.gitignore` 里那一行删掉
