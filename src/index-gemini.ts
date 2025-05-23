import MCPClient from "./MCPClient";
import GeminiAgent from "./GeminiAgent";
import ChatGemini from "./ChatGemini";
import path from "path";
import EmbeddingRetriever from "./EmbeddingRetriever";
import fs from "fs";
import { logTitle } from "./utils";

const URL = 'https://news.ycombinator.com/'
const outPath = path.join(process.cwd(), 'output');
const TASK = `
告诉我Antonette的信息,先从我给你的context中找到相关信息,总结后创作一个关于她的故事
把故事和她的基本信息保存到${outPath}/antonette.md
`

const fetchMCP = new MCPClient("mcp-server-fetch", "uvx", ['mcp-server-fetch']);
const fileMCP = new MCPClient("mcp-server-file", "npx", ['-y', '@modelcontextprotocol/server-filesystem', outPath]);

async function main() {
    // RAG
    const context = await retrieveContext();

    // 首先尝试不使用工具直接与Gemini对话
    logTitle("尝试直接与Gemini对话");
    try {
        const gemini = new ChatGemini('gemini-1.5-flash-001', '', [], context);
        const response = await gemini.generateResponse(TASK);
        console.log("Gemini直接响应:", response.content);

        // 手动保存文件
        const filePath = path.join(outPath, 'antonette.md');
        fs.writeFileSync(filePath, response.content);
        console.log(`文件已保存到 ${filePath}`);

    } catch (error: any) {
        console.error("直接对话失败:", error.message);

        // 如果直接对话失败，尝试使用Agent
        console.log("\n尝试使用Agent...");
        try {
            // Agent
            const agent = new GeminiAgent('gemini-1.5-pro', [fetchMCP, fileMCP], '', context);
            await agent.init();
            await agent.invoke(TASK);
            await agent.close();
        } catch (agentError: any) {
            console.error("Agent也失败了:", agentError.message);
        }
    }
}

main()

async function retrieveContext() {
    // RAG
    const embeddingRetriever = new EmbeddingRetriever("BAAI/bge-m3");
    const knowledgeDir = path.join(process.cwd(), 'knowledge');
    const files = fs.readdirSync(knowledgeDir);
    for await (const file of files) {
        const content = fs.readFileSync(path.join(knowledgeDir, file), 'utf-8');
        await embeddingRetriever.embedDocument(content);
    }
    const context = (await embeddingRetriever.retrieve(TASK, 5)).join('\n');
    logTitle('CONTEXT');
    console.log(context);
    return context
}