# Gemini API 集成实现

本文档介绍了如何在项目中集成并使用Google Gemini API来替代OpenAI API，以及常见问题的解决方案。

## 实现文件

1. **ChatGemini.ts** - 实现了基于Gemini API的LLM交互类，类似于ChatOpenAI.ts
2. **GeminiAgent.ts** - 实现了使用ChatGemini的Agent类，类似于Agent.ts
3. **index-gemini.ts** - 提供了使用Gemini的示例入口点

## 环境变量设置

在`.env`文件中，你需要设置：

```
GOOGLE_API_KEY=your_api_key_here
```

## 使用方法

### 直接使用ChatGemini

```typescript
import ChatGemini from "./ChatGemini";

// 初始化ChatGemini实例
const gemini = new ChatGemini('gemini-1.5-pro', '系统指令', [], '上下文信息');

// 发送消息并获取响应
const response = await gemini.generateResponse('你的提问');
console.log(response.content); // 输出响应内容
```

### 使用GeminiAgent

```typescript
import GeminiAgent from "./GeminiAgent";
import MCPClient from "./MCPClient";

// 初始化MCP客户端
const fetchMCP = new MCPClient("mcp-server-fetch", "uvx", ['mcp-server-fetch']);
const fileMCP = new MCPClient("mcp-server-file", "npx", ['-y', '@modelcontextprotocol/server-filesystem', outputPath]);

// 初始化GeminiAgent
const agent = new GeminiAgent('gemini-1.5-pro', [fetchMCP, fileMCP], '系统指令', '上下文信息', true);
await agent.init();

// 发送任务并获取响应
const result = await agent.invoke('你的任务描述');
console.log(result);

// 关闭Agent
await agent.close();
```

### 运行示例

```bash
npm run gemini-dev
```

## 常见问题及解决方案

### 1. JSON Schema 格式问题

**问题**: Gemini API对JSON Schema的格式要求与OpenAI不同，可能会报错如：
- `Invalid JSON payload received. Unknown name "additionalProperties"`
- `Starting an object on a scalar field`

**解决方案**: 
- 实现`convertToGeminiSchema`方法，将MCP工具的JSON Schema转换为Gemini API兼容的格式
- 删除不兼容属性如`$schema`、`additionalProperties`、`exclusiveMinimum`、`exclusiveMaximum`等

### 2. 工具调用错误处理

**问题**: 工具调用可能因为参数解析错误而失败

**解决方案**:
- 添加了错误处理，包括参数解析的异常捕获
- 优化了异常信息传递给模型的方式

### 3. 无工具模式

如果工具初始化出现问题，系统会回退到无工具模式，仍然允许与Gemini进行基本对话。

## Gemini与OpenAI API的主要区别

1. **Schema格式**: Gemini对JSON Schema格式要求更严格
2. **系统提示**: Gemini使用特殊格式`<system>系统提示</system>`而不是单独的角色
3. **工具定义**: 工具定义结构不同，Gemini使用`functionDeclarations`而不是`functions`
4. **响应处理**: 对工具调用的处理方式有所不同

## 调试提示

- 设置`GeminiAgent`的第五个参数为`true`可以启用调试模式，查看工具定义
- 检查工具的JSON Schema是否符合Gemini的要求
- 确保工具参数是有效的JSON结构 