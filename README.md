# 筑峰短视频宣传工作台

一个偏简单商务风的短视频宣传规划网站，支持网页端和手机端使用。团队可以按月份创建多个视频主题，记录主题主旨、预计发布时间、脚本、素材、剪辑人员、剪辑进度和最终成片。

## 当前功能

- 月度视频宣传规划：每个月可添加多个主题
- 主题分类：展会、设备交付、公司日常
- 顶部汇总：当前月份主题数、脚本完成、素材数、剪辑中、成片
- 下拉筛选：按月份、主题分类、进度阶段筛选
- 主题信息表：创建后可再次编辑
- 脚本表：可跳转 ChatGPT/Codex 生成脚本，也可上传或粘贴最终脚本
- 主题素材表：上传视频/照片素材，支持打包下载
- 素材删除：点击删除后勾选素材，确认删除会同步删除数据库记录和 Supabase Storage 文件
- 剪辑人员：可在主题信息里选择蔡颖、何冬琴、朱玮佳、杜妮 Jen
- 企业微信通知：素材确认后可通过企业微信机器人发送网页链接和手机链接
- 成片管理：对应主题上传剪辑完成短视频
- 时间记录：主题创建、脚本完成、素材确认、剪辑阶段、成片完成都会记录时间

## Supabase

已使用安全版迁移：

```text
supabase/migrations/20260716000000_secure_video_workspace.sql
```

该迁移会创建：

- `video_briefs`：视频主题和进度
- `media_assets`：主题素材
- `final_videos`：剪辑完成视频
- `video-materials`：素材存储桶
- `final-videos`：成片存储桶

RLS 已开启，默认策略是：登录用户只能管理自己创建和上传的数据。不要使用旧的公开读写策略。

## Vercel 环境变量

正式部署时需要配置：

```text
SUPABASE_URL=https://ktnhciekcqzriljvrgyl.supabase.co
SUPABASE_PUBLISHABLE_KEY=你的 Supabase publishable key
OPENAI_API_KEY=可选，用于自动生成脚本
OPENAI_MODEL=可选，默认 gpt-4.1-mini
WECOM_BOT_WEBHOOK=可选，用于企业微信机器人通知
```

## 本地预览

本地访问会自动进入演示模式，数据保存在浏览器本地。正式上传、登录、数据库同步需要部署到 Vercel 并配置 Supabase 环境变量。

当前本地预览地址：

```text
http://127.0.0.1:4174/?v=20260716q
```

## 文件结构

```text
index.html
styles.css
app.js
api/config.js
api/generate-script.js
api/send-wecom.js
supabase/migrations/20260716000000_secure_video_workspace.sql
vercel.json
.github/workflows/ci.yml
```
