# Moat — AI 编码护城河

## 铁律
改代码**前**跑一次，改代码**后**再跑一次。两次都通过才能提交。

```bash
moat check
```

## 基线
系统状态基线保存在 `.moat/baseline.json`。
如果允许的改动会导致基线变化，先更新基线：

```bash
moat baseline save
```

## 实时监控
服务器运行中，实时查看错误：

```bash
moat watch --log logs/backend.log
```

## 规则
1. 修完 bug 必须 `moat check` 确认没有引入新问题
2. 不做测试覆盖的改动不能提交
3. 如果 `moat check` 报错，修到通过为止
