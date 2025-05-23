import MCPClient from "./MCPClient";
import ChatGemini from "./ChatGemini";
import { logTitle } from "./utils";

export default class GeminiAgent {
    private mcpClients: MCPClient[];
    private llm: ChatGemini | null = null;
    private model: string;
    private systemPrompt: string;
    private context: string;
    private debug: boolean;

    constructor(model: string, mcpClients: MCPClient[] = [], systemPrompt: string = '', context: string = '', debug: boolean = false) {
        this.mcpClients = mcpClients;
        this.model = model;
        this.systemPrompt = systemPrompt;
        this.context = context;
        this.debug = debug;
    }

    async init() {
        logTitle('TOOLS');
        
        if (this.debug) {
            console.log("初始化GeminiAgent，model:", this.model);
            if (this.context) {
                console.log("上下文长度:", this.context.length, "字符");
                console.log("上下文预览:", this.context.substring(0, 200) + "...");
            }
        }
        
        // 如果没有MCP客户端，直接初始化LLM
        if (this.mcpClients.length === 0) {
            if (this.debug) console.log("无MCP客户端，直接使用LLM");
            this.llm = new ChatGemini(this.model, this.systemPrompt, [], this.context);
            return;
        }
        
        // 否则初始化所有MCP客户端
        for await (const client of this.mcpClients) {
            await client.init();
        }

        try {
            // 获取所有工具定义
            const tools = this.mcpClients.flatMap(client => client.getTools());
            
            if (this.debug) {
                console.log("工具定义:", JSON.stringify(tools, null, 2));
            }
            
            // 初始化LLM，传入上下文
            this.llm = new ChatGemini(this.model, this.systemPrompt, tools, this.context);
        } catch (error: any) {
            console.error("初始化工具时出错:", error.message);
            // 如果工具初始化失败，仍然创建LLM但不使用工具
            this.llm = new ChatGemini(this.model, this.systemPrompt, [], this.context);
        }
    }

    async close() {
        if (this.mcpClients.length > 0) {
            for await (const client of this.mcpClients) {
                await client.close();
            }
        }
    }

    async invoke(prompt: string) {
        if (!this.llm) throw new Error('Agent not initialized');
        
        try {
            if (this.debug) {
                console.log("调用Gemini，prompt:", prompt.substring(0, 100) + "...");
            }
            
            let response = await this.llm.generateResponse(prompt);
            
            // 如果没有MCP客户端或没有工具调用，直接返回响应
            if (this.mcpClients.length === 0 || response.toolCalls.length === 0) {
                if (this.debug) console.log("无工具调用，直接返回响应");
                return response.content;
            }
            
            // 处理工具调用循环
            while (response.toolCalls.length > 0) {
                if (this.debug) console.log(`发现${response.toolCalls.length}个工具调用`);
                
                for (const toolCall of response.toolCalls) {
                    const mcp = this.mcpClients.find(client => client.getTools().some((t: any) => t.name === toolCall.function.name));
                    if (mcp) {
                        logTitle(`TOOL USE`);
                        console.log(`Calling tool: ${toolCall.function.name}`);
                        console.log(`Arguments: ${toolCall.function.arguments}`);
                        
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            const result = await mcp.callTool(toolCall.function.name, args);
                            console.log(`Result: ${JSON.stringify(result)}`);
                            this.llm.appendToolResult(toolCall.id, JSON.stringify(result));
                        } catch (parseError: any) {
                            console.error(`解析工具参数时出错: ${parseError.message}`);
                            this.llm.appendToolResult(toolCall.id, `Error parsing arguments: ${parseError.message}`);
                        }
                    } else {
                        console.warn(`找不到工具: ${toolCall.function.name}`);
                        this.llm.appendToolResult(toolCall.id, 'Tool not found');
                    }
                }
                // 工具调用后,继续对话
                response = await this.llm.generateResponse();
            }
            
            // 没有更多工具调用，结束对话
            await this.close();
            return response.content;
        } catch (error: any) {
            console.error(`调用过程中出错: ${error.message}`);
            await this.close();
            throw error;
        }
    }
} 