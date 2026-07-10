# 贡献指南

感谢你对 One Memory 项目的关注！🎉

## 如何贡献

### 报告 Bug

如果你发现了 Bug，请在 [GitHub Issues](https://github.com/wang-jie-git/one-memory/issues) 中创建 issue，并包含以下信息：

- Bug 描述
- 复现步骤
- 预期行为
- 实际行为
- 环境信息（OS, Node.js 版本等）
- 错误日志（如果有）

### 提交功能请求

在 [GitHub Issues](https://github.com/wang-jie-git/one-memory/issues) 中创建 feature request，描述：

- 功能的用途
- 使用场景
- 可能的实现方案（可选）

### 提交 Pull Request

1. **Fork 仓库**
   ```bash
   # Fork 后在本地克隆
   git clone https://github.com/<your-username>/one-memory.git
   cd one-memory
   ```

2. **创建分支**
   ```bash
   git checkout -b feat/your-feature-name
   # 或
   git checkout -b fix/your-bug-fix
   ```

3. **安装依赖**
   ```bash
   npm install
   # 或
   pnpm install
   ```

4. **进行开发**
   - 遵循现有的代码风格
   - 添加测试（如果适用）
   - 更新文档

5. **运行检查**
   ```bash
   # 运行 Moat 代码质量检查
   moat check
   
   # 运行测试
   pnpm test
   
   # TypeScript 类型检查
   pnpm typecheck
   ```

6. **提交代码**
   ```bash
   git add .
   git commit -m "feat: add your feature"
   # 遵循 [Conventional Commits](https://www.conventionalcommits.org/)
   ```

7. **推送到你的 Fork**
   ```bash
   git push origin feat/your-feature-name
   ```

8. **创建 Pull Request**
   - 在 GitHub 上创建 PR
   - 填写 PR 描述
   - 等待 Code Review

## 开发规范

### 代码风格

- **TypeScript 严格模式**: 所有代码必须通过 TypeScript 严格模式检查
- **命名规范**: 
  - 文件名: `kebab-case.ts`
  - 类名: `PascalCase`
  - 函数/变量: `camelCase`
  - 常量: `UPPER_SNAKE_CASE`
- **注释**: 关键逻辑必须有注释（中文或英文）

### 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Type 类型**:
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具相关

**示例**:
```bash
feat(memory-graph): add auto-linker for code symbols
fix(memory-vector): resolve IVF index bug
docs: update README with new features
```

### 测试规范

- 所有新功能必须添加测试
- 测试文件: `*.test.ts`
- 使用 `vitest` 测试框架
- 测试覆盖率 ≥ 80%

### Moat 代码质量检查

项目使用 [Moat](https://github.com/wang-jie-git/moat) 进行代码质量检查：

```bash
# 安装 Moat
pip install moat-ai

# 运行检查
moat check

# 查看详细报告
moat report --format md
```

**必须通过所有检查才能合并 PR**

## 项目结构

```
one-memory/
├── packages/
│   ├── memory-graph/          # 图数据库层
│   ├── memory-vector/         # 向量存储层
│   ├── memory-orchestrator/   # 统一编排层
│   ├── memory-mcp/            # MCP 服务器
│   └── memory-cli/            # CLI 工具
├── specs/                     # 架构规格文档
├── examples/                  # 使用示例
└── types/                     # TypeScript 类型定义
```

## 开发流程

1. 从 `develop` 分支创建功能分支
2. 开发并测试
3. 提交 PR 到 `develop`
4. Code Review 通过后合并到 `develop`
5. 定期将 `develop` 合并到 `main` 发布

## 问题反馈

如有问题，请通过以下方式联系：

- GitHub Issues: https://github.com/wang-jie-git/one-memory/issues
- Email: qcrsh@gitee.com

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件
