# 上线到 GitHub Pages

这个项目是纯静态网页，不需要构建、不需要服务器，可以直接用 GitHub Pages 免费托管。

## 一、先在本地留一个可回退的版本

（这一步我已经做过了，仓库里应该已经有一次提交。）

```
git log --oneline
```

## 二、在 GitHub 上建仓库

1. 打开 https://github.com/new
2. **Repository name** 填一个名字，例如 `anh-ui-handbook`
3. 选择 **Public**（公开）
4. **不要**勾选 Add a README / .gitignore / license —— 本地已经有文件了，勾了反而冲突
5. 点 **Create repository**

## 三、把本地内容推上去

创建完成后，GitHub 会显示仓库地址，形如
`https://github.com/你的用户名/anh-ui-handbook.git`。在本项目目录执行：

```
git remote add origin https://github.com/你的用户名/anh-ui-handbook.git
git push -u origin main
```

第一次推送会弹窗要求登录 GitHub（浏览器授权或输入账号 + 令牌），按提示完成即可。
如果弹的是"密码"输入框且提示不支持密码，就去
https://github.com/settings/tokens 生成一个 token（勾选 `repo`），把它当密码填进去。

## 四、打开网页

1. 仓库页面 → **Settings** → 左侧 **Pages**
2. **Source** 选 `Deploy from a branch`
3. **Branch** 选 `main`，目录选 `/ (root)`，点 **Save**
4. 等 1～2 分钟，页面顶部会出现网址，形如
   `https://你的用户名.github.io/anh-ui-handbook/`

这个网址就是最终链接，手机、别人的电脑都能直接打开，不用你开机、不用连你的局域网。
它同时支持 `https`，书签、剪贴板这些功能在手机上会更正常。

## 五、以后再改内容

改完 `source/` 里的目录或补充材料后，跑：

```
python tools/build_data.py
python tools/build_single.py
git add -A
git commit -m "更新手册内容"
git push
```

GitHub Pages 会自动重新发布，一两分钟后生效。

## 说明

- `dist/学生手册查询.html` 是单文件版，也会一起发布，别人可以直接下载到自己手机上用。
- 原始扫描件 `source/handbook-original.doc` 已在 `.gitignore` 里排除，不会上传。
  如果想连原始文件一起传，把 `.gitignore` 里那一行删掉即可。
- 想让页面出现在仓库主页展示栏，可以在仓库 **Settings → Pages** 里换个自定义域名，
  或者把网址写进仓库的 About 描述。
