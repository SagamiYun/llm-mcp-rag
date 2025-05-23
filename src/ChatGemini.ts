import { GoogleGenerativeAI, GenerativeModel, ChatSession } from "@google/generative-ai";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import 'dotenv/config'
import { logTitle } from "./utils";

export interface ToolCall {
    id: string;
    function: {
        name: string;
        arguments: string;
    };
}

interface FunctionCall {
    name: string;
    args: Record<string, any>;
}

export default class ChatGemini {
    private llm: GenerativeModel;
    private model: string;
    private messages: Array<{ role: string, parts: Array<{ text: string }> }> = [];
    private tools: Tool[];
    private chatSession: ChatSession;
    private toolCallIdCounter = 0; // 用于生成工具调用ID

    constructor(model: string, systemPrompt: string = '', tools: Tool[] = [], context: string = '') {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
        this.model = model;
        this.tools = tools;
        
        // 创建Gemini模型实例
        this.llm = genAI.getGenerativeModel({
            model: this.model,
            // 如果有工具，则添加工具定义
            ...this.tools.length > 0 && { tools: this.getToolsDefinition() }
        });
        
        // 初始化聊天历史
        const historyMessages: Array<{ role: string, parts: Array<{ text: string }> }> = [];
        
        // 添加系统提示（如果有的话）
        if (systemPrompt) {
            historyMessages.push({
                role: "user",
                parts: [{ text: `<system>${systemPrompt}</system>` }]
            });
            historyMessages.push({
                role: "model",
                parts: [{ text: "I'll follow these instructions." }]
            });
        }
        
        // 添加上下文（如果有的话）- 使用格式化的方式增强上下文识别
        if (context) {
            historyMessages.push({
                role: "user",
                parts: [{ text: `下面是参考上下文信息，请仔细阅读作为后续回答的依据：\n\n===开始参考上下文===\n${context}\n===结束参考上下文===\n\n请记住上述信息，我将在下一条消息中询问相关问题。` }]
            });
            historyMessages.push({
                role: "model",
                parts: [{ text: "我已理解这些上下文信息，请继续提问。" }]
            });
        }
        
        // 初始化聊天会话
        this.chatSession = this.llm.startChat({
            history: historyMessages,
        });
        
        // 保存消息历史
        this.messages = [...historyMessages];
    }

    async generateResponse(prompt?: string): Promise<{ content: string, toolCalls: ToolCall[] }> {
        logTitle('CHAT');
        if (prompt) {
            // 将用户消息添加到历史记录
            this.messages.push({ 
                role: "user", 
                parts: [{ text: prompt }] 
            });
        }
        
        // 发送消息到Gemini
        const result = await this.chatSession.sendMessage(
            prompt ? [{ text: prompt }] : [{ text: this.messages[this.messages.length - 1].parts[0].text }]
        );
        
        const response = result.response;
        const content = response.text();
        logTitle('RESPONSE');
        process.stdout.write(content);
        
        let toolCalls: ToolCall[] = [];
        
        // 处理工具调用
        if (response.candidates && response.candidates.length > 0) {
            const firstCandidate = response.candidates[0];
            if (firstCandidate.content && firstCandidate.content.parts) {
                for (const part of firstCandidate.content.parts) {
                    if (part && typeof part === 'object' && 'functionCall' in part) {
                        // 使用类型断言处理functionCall
                        const functionCallPart = part as { functionCall: FunctionCall };
                        const functionCall = functionCallPart.functionCall;
                        
                        this.toolCallIdCounter++;
                        toolCalls.push({
                            id: `call_${this.toolCallIdCounter}`,
                            function: {
                                name: functionCall.name,
                                arguments: JSON.stringify(functionCall.args)
                            }
                        });
                    }
                }
            }
        }
        
        // 将助手响应添加到历史记录
        this.messages.push({ 
            role: "model", 
            parts: [{ text: content }]
        });
        
        return {
            content: content,
            toolCalls: toolCalls,
        };
    }

    public appendToolResult(toolCallId: string, toolOutput: string) {
        // 将工具结果作为用户消息添加到聊天历史中
        this.messages.push({
            role: "user",
            parts: [{ text: `Tool result for ${toolCallId}: ${toolOutput}` }]
        });
        
        // 创建新的聊天会话以包含工具结果
        this.chatSession = this.llm.startChat({
            history: this.messages,
        });
    }

    // 将JSON Schema转换为Gemini兼容格式
    private convertToGeminiSchema(schema: any): any {
        // 如果不是对象，直接返回
        if (typeof schema !== 'object' || schema === null) {
            return schema;
        }
        
        // 基础schema对象
        const baseSchema: any = {
            type: schema.type || 'object',
        };
        
        // 处理描述
        if (schema.description) {
            baseSchema.description = schema.description;
        }
        
        // 处理枚举值
        if (schema.enum) {
            baseSchema.enum = schema.enum;
        }
        
        // 处理必填字段
        if (schema.required) {
            baseSchema.required = schema.required;
        }
        
        // 处理对象属性
        if (schema.type === 'object' && schema.properties) {
            baseSchema.properties = {};
            for (const key in schema.properties) {
                baseSchema.properties[key] = this.convertToGeminiSchema(schema.properties[key]);
            }
        }
        
        // 处理数组项
        if (schema.type === 'array' && schema.items) {
            baseSchema.items = this.convertToGeminiSchema(schema.items);
        }
        
        // 处理其他有效的JSON Schema属性
        const validProps = ['minimum', 'maximum', 'format', 'pattern', 'default'];
        for (const prop of validProps) {
            if (schema[prop] !== undefined) {
                baseSchema[prop] = schema[prop];
            }
        }
        
        return baseSchema;
    }

    private getToolsDefinition(): any[] {
        try {
            // 输出每个工具的原始schema进行调试
            this.tools.forEach((tool, index) => {
                console.log(`原始工具 ${index} - ${tool.name}:`, tool.inputSchema);
            });
            
            // 使用简化的schema结构
            const toolDefinitions = this.tools.map((tool) => {
                const convertedSchema = this.convertToGeminiSchema(tool.inputSchema);
                console.log(`转换后工具 - ${tool.name}:`, convertedSchema);
                
                return {
                    functionDeclarations: [{
                        name: tool.name,
                        description: tool.description || '',
                        parameters: convertedSchema
                    }]
                };
            });
            
            return toolDefinitions;
        } catch (error) {
            console.error("转换工具定义时出错:", error);
            // 返回空数组，不使用工具
            return [];
        }
    }
} 