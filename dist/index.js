#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { TodoistApi } from "@doist/todoist-api-typescript";
// Define tools
const CREATE_TASK_TOOL = {
    name: "todoist_create_task",
    description: "Create a new task in Todoist with optional description, due date, and priority",
    inputSchema: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "The content/title of the task"
            },
            project_id: {
                type: "string",
                description: "Project ID to create the task in (optional)"
            },
            project_name: {
                type: "string",
                description: "Project name to create the task in (optional; ignored if project_id provided)"
            },
            section_id: {
                type: "string",
                description: "Section ID to create the task in (optional)"
            },
            section_name: {
                type: "string",
                description: "Section name to create the task in (optional; requires project resolution)"
            },
            parent_task_id: {
                type: "string",
                description: "Create as a subtask of this task ID (optional)"
            },
            parent_task_name: {
                type: "string",
                description: "Create as a subtask of the task matching this name (optional; disambiguated similarly to other name searches)"
            },
            description: {
                type: "string",
                description: "Detailed description of the task (optional)"
            },
            due_string: {
                type: "string",
                description: "Natural language due date like 'tomorrow', 'next Monday', 'Jan 23' (optional)"
            },
            priority: {
                type: "number",
                description: "Task priority from 1 (normal) to 4 (urgent) (optional)",
                enum: [1, 2, 3, 4]
            }
        },
        required: ["content"]
    }
};
const GET_TASKS_TOOL = {
    name: "todoist_get_tasks",
    description: "Get a list of tasks from Todoist with various filters",
    inputSchema: {
        type: "object",
        properties: {
            project_id: {
                type: "string",
                description: "Filter tasks by project ID (optional)"
            },
            project_name: {
                type: "string",
                description: "Filter tasks by project name (optional)"
            },
            filter: {
                type: "string",
                description: "Natural language filter like 'today', 'tomorrow', 'next week', 'priority 1', 'overdue' (optional)"
            },
            label_name: {
                type: "string",
                description: "Filter tasks by a single label name (optional)"
            },
            priority: {
                type: "number",
                description: "Filter by priority level (1-4) (optional)",
                enum: [1, 2, 3, 4]
            },
            limit: {
                type: "number",
                description: "Maximum number of tasks to return (optional)",
                default: 10
            }
        }
    }
};
const UPDATE_TASK_TOOL = {
    name: "todoist_update_task",
    description: "Update an existing task in Todoist by searching for it by name and then updating it",
    inputSchema: {
        type: "object",
        properties: {
            task_id: {
                type: "string",
                description: "Exact ID of the task to update (preferred if available)"
            },
            task_name: {
                type: "string",
                description: "Name/content of the task to search for and update"
            },
            project_name: {
                type: "string",
                description: "Optional project name to narrow the search when using task_name"
            },
            content: {
                type: "string",
                description: "New content/title for the task (optional)"
            },
            description: {
                type: "string",
                description: "New description for the task (optional)"
            },
            due_string: {
                type: "string",
                description: "New due date in natural language like 'tomorrow', 'next Monday' (optional)"
            },
            priority: {
                type: "number",
                description: "New priority level from 1 (normal) to 4 (urgent) (optional)",
                enum: [1, 2, 3, 4]
            }
        },
        required: []
    }
};
const DELETE_TASK_TOOL = {
    name: "todoist_delete_task",
    description: "Delete a task from Todoist by searching for it by name",
    inputSchema: {
        type: "object",
        properties: {
            task_id: {
                type: "string",
                description: "Exact ID of the task to delete (preferred if available)"
            },
            task_name: {
                type: "string",
                description: "Name/content of the task to search for and delete"
            },
            project_name: {
                type: "string",
                description: "Optional project name to narrow the search when using task_name"
            }
        },
        required: []
    }
};
const COMPLETE_TASK_TOOL = {
    name: "todoist_complete_task",
    description: "Mark a task as complete by searching for it by name",
    inputSchema: {
        type: "object",
        properties: {
            task_id: {
                type: "string",
                description: "Exact ID of the task to complete (preferred if available)"
            },
            task_name: {
                type: "string",
                description: "Name/content of the task to search for and complete"
            },
            project_name: {
                type: "string",
                description: "Optional project name to narrow the search when using task_name"
            }
        },
        required: []
    }
};
// New read-only tools
const LIST_PROJECTS_TOOL = {
    name: "todoist_list_projects",
    description: "List all projects with their IDs and names",
    inputSchema: { type: "object", properties: {} }
};
const LIST_LABELS_TOOL = {
    name: "todoist_list_labels",
    description: "List all labels with their IDs and names",
    inputSchema: { type: "object", properties: {} }
};
const GET_PROJECTS_WITH_TASKS_TOOL = {
    name: "todoist_get_projects_with_tasks",
    description: "List projects and their open tasks in a single call",
    inputSchema: {
        type: "object",
        properties: {
            project_name: { type: "string", description: "Optional project name to restrict the listing" },
            include_empty: { type: "boolean", description: "Include projects with no open tasks", default: false },
            limit_per_project: { type: "number", description: "Max tasks per project", default: 10 },
            label_name: { type: "string", description: "Filter tasks by single label name (optional)" },
            filter: { type: "string", description: "Todoist filter string applied per project (optional)" },
            priority: { type: "number", description: "Filter tasks by priority (1-4)", enum: [1, 2, 3, 4] }
        }
    }
};
const GET_COMPLETED_TASKS_TOOL = {
    name: "todoist_get_completed_tasks",
    description: "List completed tasks with optional project and date filters",
    inputSchema: {
        type: "object",
        properties: {
            project_id: { type: "string", description: "Filter by project ID (optional)" },
            project_name: { type: "string", description: "Filter by project name (optional)" },
            since: { type: "string", description: "ISO datetime to filter tasks completed since (optional)" },
            until: { type: "string", description: "ISO datetime to filter tasks completed until (optional)" },
            limit: { type: "number", description: "Maximum number of completed tasks to return (optional)", default: 20 }
        }
    }
};
// Sections tools
const LIST_SECTIONS_TOOL = {
    name: "todoist_list_sections",
    description: "List sections, optionally filtered by project (name or ID)",
    inputSchema: {
        type: "object",
        properties: {
            project_id: { type: "string", description: "Project ID to list sections for (optional)" },
            project_name: { type: "string", description: "Project name to list sections for (optional)" }
        }
    }
};
const CREATE_SECTION_TOOL = {
    name: "todoist_create_section",
    description: "Create a section in a project",
    inputSchema: {
        type: "object",
        properties: {
            name: { type: "string", description: "Section name" },
            project_id: { type: "string", description: "Project ID (preferred)" },
            project_name: { type: "string", description: "Project name (used if project_id not provided)" }
        },
        required: ["name"]
    }
};
// Project management and task movement tools
const CREATE_PROJECT_TOOL = {
    name: "todoist_create_project",
    description: "Create a new project (optionally nested)",
    inputSchema: {
        type: "object",
        properties: {
            name: { type: "string", description: "Project name" },
            parent_project_id: { type: "string", description: "Optional parent project ID" },
            parent_project_name: { type: "string", description: "Optional parent project name" },
            favorite: { type: "boolean", description: "Mark as favorite (optional)" }
        },
        required: ["name"]
    }
};
const RENAME_PROJECT_TOOL = {
    name: "todoist_rename_project",
    description: "Rename an existing project",
    inputSchema: {
        type: "object",
        properties: {
            project_id: { type: "string", description: "ID of the project to rename (preferred)" },
            project_name: { type: "string", description: "Name of the project to rename (if ID unknown)" },
            new_name: { type: "string", description: "New name for the project" }
        },
        required: ["new_name"]
    }
};
const DELETE_PROJECT_TOOL = {
    name: "todoist_delete_project",
    description: "Delete a project (destructive)",
    inputSchema: {
        type: "object",
        properties: {
            project_id: { type: "string", description: "ID of the project to delete (preferred)" },
            project_name: { type: "string", description: "Name of the project to delete (if ID unknown)" }
        },
        required: []
    }
};
// Note: Todoist REST API does not support moving a task by updating projectId.
// Use updateTask on other fields only. Project moves require re-creating the task.
// Server implementation
const server = new Server({
    name: "todoist-mcp-server",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Check for API token
const TODOIST_API_TOKEN = process.env.TODOIST_API_TOKEN;
if (!TODOIST_API_TOKEN) {
    console.error("Error: TODOIST_API_TOKEN environment variable is required");
    process.exit(1);
}
// Initialize Todoist client
const todoistClient = new TodoistApi(TODOIST_API_TOKEN);
// Type guards for arguments
function isCreateTaskArgs(args) {
    return (typeof args === "object" &&
        args !== null &&
        "content" in args &&
        typeof args.content === "string");
}
function isGetTasksArgs(args) {
    return (typeof args === "object" &&
        args !== null);
}
function isGetCompletedTasksArgs(args) {
    return (typeof args === "object" &&
        args !== null);
}
function isUpdateTaskArgs(args) {
    return (typeof args === "object" &&
        args !== null &&
        ("task_id" in args || "task_name" in args));
}
function isDeleteTaskArgs(args) {
    return (typeof args === "object" &&
        args !== null &&
        ("task_id" in args || "task_name" in args));
}
function isCompleteTaskArgs(args) {
    return (typeof args === "object" &&
        args !== null &&
        ("task_id" in args || "task_name" in args));
}
// Helpers
async function resolveProjectIdByName(name) {
    const projects = await todoistClient.getProjects();
    const hit = projects.find(p => p.name.toLowerCase() === name.toLowerCase());
    return hit?.id;
}
async function resolveLabelIdByName(name) {
    const labels = await todoistClient.getLabels();
    const hit = labels.find(l => l.name.toLowerCase() === name.toLowerCase());
    return hit?.id;
}
async function resolveSectionIdByName(projectId, name) {
    const sections = await todoistClient.getSections(projectId);
    const hit = sections.find(s => s.name.toLowerCase() === name.toLowerCase());
    return hit?.id;
}
async function disambiguateByName(nameQuery, projectName) {
    let projectId;
    if (projectName) {
        projectId = await resolveProjectIdByName(projectName);
    }
    const tasks = await todoistClient.getTasks(projectId ? { projectId } : undefined);
    const matches = tasks.filter(t => t.content.toLowerCase().includes(nameQuery.toLowerCase()));
    return { matches, projectId };
}
// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        CREATE_TASK_TOOL,
        GET_TASKS_TOOL,
        GET_COMPLETED_TASKS_TOOL,
        GET_PROJECTS_WITH_TASKS_TOOL,
        UPDATE_TASK_TOOL,
        DELETE_TASK_TOOL,
        COMPLETE_TASK_TOOL,
        LIST_PROJECTS_TOOL,
        LIST_LABELS_TOOL,
        LIST_SECTIONS_TOOL,
        CREATE_SECTION_TOOL,
        CREATE_PROJECT_TOOL,
        RENAME_PROJECT_TOOL,
        DELETE_PROJECT_TOOL,
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        const { name, arguments: args } = request.params;
        if (!args) {
            throw new Error("No arguments provided");
        }
        if (name === "todoist_create_task") {
            if (!isCreateTaskArgs(args)) {
                throw new Error("Invalid arguments for todoist_create_task");
            }
            let projectId = args.project_id;
            if (!projectId && args.project_name) {
                projectId = await resolveProjectIdByName(args.project_name);
            }
            let sectionId = args.section_id;
            if (!sectionId && args.section_name && projectId) {
                sectionId = await resolveSectionIdByName(projectId, args.section_name);
            }
            // Resolve parent task by name if needed
            let parentId = args.parent_task_id;
            if (!parentId && args.parent_task_name) {
                const { matches } = await disambiguateByName(args.parent_task_name, args.project_name);
                if (matches.length === 1)
                    parentId = matches[0].id;
                else if (matches.length > 1) {
                    const list = matches.slice(0, 10).map(t => `- ${t.content} (id: ${t.id})`).join('\n');
                    return { content: [{ type: 'text', text: `Multiple tasks match parent_task_name. Please specify parent_task_id:\n${list}` }], isError: true };
                }
            }
            const task = await todoistClient.addTask({
                content: args.content,
                description: args.description,
                dueString: args.due_string,
                priority: args.priority,
                projectId,
                sectionId,
                parentId
            });
            return {
                content: [{
                        type: "text",
                        text: `Task created:\nTitle: ${task.content} (id: ${task.id})${task.description ? `\nDescription: ${task.description}` : ''}${task.due ? `\nDue: ${task.due.string}` : ''}${task.priority ? `\nPriority: ${task.priority}` : ''}${task.projectId ? `\nProjectId: ${task.projectId}` : ''}`
                    }],
                isError: false,
            };
        }
        if (name === "todoist_get_tasks") {
            if (!isGetTasksArgs(args)) {
                throw new Error("Invalid arguments for todoist_get_tasks");
            }
            // Only pass filter if at least one filtering parameter is provided
            const apiParams = {};
            // Resolve project by name if provided
            if (args.project_name && !args.project_id) {
                const resolved = await resolveProjectIdByName(args.project_name);
                if (resolved)
                    apiParams.projectId = resolved;
            }
            if (args.project_id) {
                apiParams.projectId = args.project_id;
            }
            // Resolve label by name if provided
            if (args.label_name) {
                const labelId = await resolveLabelIdByName(args.label_name);
                if (labelId)
                    apiParams.labelIds = [labelId];
            }
            if (args.filter) {
                apiParams.filter = args.filter;
            }
            // If no filters provided, default to showing all tasks
            const tasks = await todoistClient.getTasks(Object.keys(apiParams).length > 0 ? apiParams : undefined);
            // Apply additional filters
            let filteredTasks = tasks;
            if (args.priority) {
                filteredTasks = filteredTasks.filter(task => task.priority === args.priority);
            }
            // Apply limit
            if (args.limit && args.limit > 0) {
                filteredTasks = filteredTasks.slice(0, args.limit);
            }
            // Map projects for display
            const projects = await todoistClient.getProjects();
            const projectNameById = new Map(projects.map(p => [p.id, p.name]));
            const taskList = filteredTasks.map(task => {
                const proj = projectNameById.get(task.projectId);
                return `- ${task.content} (id: ${task.id})${proj ? `\n  Project: ${proj}` : ''}${task.description ? `\n  Description: ${task.description}` : ''}${task.due ? `\n  Due: ${task.due.string}` : ''}${task.priority ? `\n  Priority: ${task.priority}` : ''}`;
            }).join('\n\n');
            return {
                content: [
                    { type: "text", text: filteredTasks.length > 0 ? taskList : "No tasks found matching the criteria" },
                    { type: "text", text: `JSON: ${JSON.stringify(filteredTasks.map(t => ({ id: t.id, content: t.content, projectId: t.projectId, due: t.due?.string ?? null, priority: t.priority ?? null })))}` }
                ],
                isError: false,
            };
        }
        if (name === "todoist_get_projects_with_tasks") {
            const a = request.params.arguments;
            const includeEmpty = !!a?.include_empty;
            const limitPer = (typeof a?.limit_per_project === 'number' && a.limit_per_project > 0) ? a.limit_per_project : 10;
            let projects = await todoistClient.getProjects();
            if (a?.project_name) {
                const pn = String(a.project_name).toLowerCase();
                projects = projects.filter(p => p.name.toLowerCase() === pn);
            }
            const results = [];
            for (const p of projects) {
                const params = { projectId: p.id };
                if (a?.label_name)
                    params.label = a.label_name;
                if (a?.filter)
                    params.filter = a.filter;
                let tasks = await todoistClient.getTasks(params);
                if (a?.priority)
                    tasks = tasks.filter(t => t.priority === a.priority);
                if (limitPer)
                    tasks = tasks.slice(0, limitPer);
                if (tasks.length > 0 || includeEmpty) {
                    results.push({ project: { id: p.id, name: p.name }, tasks });
                }
            }
            const text = results.map(r => {
                const header = `Project: ${r.project.name} (id: ${r.project.id})`;
                if (r.tasks.length === 0)
                    return `${header}\n  (no open tasks)`;
                const items = r.tasks.map(t => `- ${t.content} (id: ${t.id})${t.due ? `\n  Due: ${t.due.string}` : ''}${t.priority ? `\n  Priority: ${t.priority}` : ''}`).join('\n');
                return `${header}\n${items}`;
            }).join('\n\n');
            const json = results.map(r => ({
                project: r.project,
                tasks: r.tasks.map(t => ({ id: t.id, content: t.content, due: t.due?.string ?? null, priority: t.priority ?? null }))
            }));
            return {
                content: [
                    { type: 'text', text: results.length ? text : 'No projects/tasks found for the given criteria' },
                    { type: 'text', text: `JSON: ${JSON.stringify(json)}` }
                ],
                isError: false,
            };
        }
        if (name === "todoist_get_completed_tasks") {
            if (!isGetCompletedTasksArgs(args)) {
                throw new Error("Invalid arguments for todoist_get_completed_tasks");
            }
            let projectId = args.project_id;
            if (!projectId && args.project_name) {
                projectId = await resolveProjectIdByName(args.project_name);
            }
            // Paginate through API v1 completed tasks endpoint
            const baseUrl = 'https://api.todoist.com/api/v1/tasks/completed';
            const headers = { Authorization: `Bearer ${TODOIST_API_TOKEN}` };
            const collected = [];
            let cursor;
            const max = args.limit && args.limit > 0 ? args.limit : 20;
            for (let i = 0; i < 50; i++) {
                const url = new URL(baseUrl);
                url.searchParams.set('limit', '200');
                if (cursor)
                    url.searchParams.set('cursor', cursor);
                if (projectId)
                    url.searchParams.set('project_id', projectId);
                if (args.since)
                    url.searchParams.set('since', args.since);
                if (args.until)
                    url.searchParams.set('until', args.until);
                const resp = await fetch(url.toString(), { headers });
                if (!resp.ok) {
                    throw new Error(`Failed to fetch completed tasks: ${resp.status} ${resp.statusText}`);
                }
                const data = await resp.json();
                const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
                for (const it of items) {
                    collected.push(it);
                    if (collected.length >= max)
                        break;
                }
                if (collected.length >= max)
                    break;
                cursor = data?.next_cursor ?? undefined;
                if (!cursor)
                    break;
            }
            // Format output
            const lines = collected.map(t => {
                const title = t.content || t.task?.content || '(untitled)';
                const id = t.id || t.task_id || t.task?.id || '';
                const completedAt = t.completed_at || t.task?.completed_at || '';
                return `- ${title}${id ? ` (id: ${id})` : ''}${completedAt ? `\n  Completed: ${completedAt}` : ''}`;
            }).join('\n');
            return {
                content: [
                    { type: 'text', text: collected.length ? lines : 'No completed tasks found' },
                    { type: 'text', text: `JSON: ${JSON.stringify(collected.map(t => ({ id: t.id || t.task_id || t.task?.id || null, content: t.content || t.task?.content || null, completed_at: t.completed_at || t.task?.completed_at || null })))}` }
                ],
                isError: false,
            };
        }
        if (name === "todoist_update_task") {
            if (!isUpdateTaskArgs(args)) {
                throw new Error("Invalid arguments for todoist_update_task");
            }
            // Determine target task
            let targetId = args.task_id;
            let matchingTaskContent = '';
            if (!targetId) {
                if (!args.task_name) {
                    throw new Error("Provide either task_id or task_name");
                }
                const { matches } = await disambiguateByName(args.task_name, args.project_name);
                if (matches.length === 0) {
                    return {
                        content: [{ type: "text", text: `Could not find a task matching "${args.task_name}"${args.project_name ? ` in project "${args.project_name}"` : ''}` }],
                        isError: true,
                    };
                }
                if (matches.length > 1) {
                    const list = matches.slice(0, 10).map(t => `- ${t.content} (id: ${t.id})`).join('\n');
                    return {
                        content: [{ type: "text", text: `Multiple tasks match "${args.task_name}". Please specify task_id to proceed:\n${list}` }],
                        isError: true,
                    };
                }
                targetId = matches[0].id;
                matchingTaskContent = matches[0].content;
            }
            // Build update data
            const updateData = {};
            if (args.content)
                updateData.content = args.content;
            if (args.description)
                updateData.description = args.description;
            if (args.due_string)
                updateData.dueString = args.due_string;
            if (args.priority)
                updateData.priority = args.priority;
            const updatedTask = await todoistClient.updateTask(targetId, updateData);
            return {
                content: [{
                        type: "text",
                        text: `Task "${matchingTaskContent || updatedTask.content}" (id: ${updatedTask.id}) updated:\nNew Title: ${updatedTask.content}${updatedTask.description ? `\nNew Description: ${updatedTask.description}` : ''}${updatedTask.due ? `\nNew Due Date: ${updatedTask.due.string}` : ''}${updatedTask.priority ? `\nNew Priority: ${updatedTask.priority}` : ''}`
                    }],
                isError: false,
            };
        }
        if (name === "todoist_delete_task") {
            if (!isDeleteTaskArgs(args)) {
                throw new Error("Invalid arguments for todoist_delete_task");
            }
            // Determine target task
            let targetId = args.task_id;
            let targetContent = '';
            if (!targetId) {
                if (!args.task_name) {
                    throw new Error("Provide either task_id or task_name");
                }
                const { matches } = await disambiguateByName(args.task_name, args.project_name);
                if (matches.length === 0) {
                    return {
                        content: [{ type: "text", text: `Could not find a task matching "${args.task_name}"${args.project_name ? ` in project "${args.project_name}"` : ''}` }],
                        isError: true,
                    };
                }
                if (matches.length > 1) {
                    const list = matches.slice(0, 10).map(t => `- ${t.content} (id: ${t.id})`).join('\n');
                    return {
                        content: [{ type: "text", text: `Multiple tasks match "${args.task_name}". Please specify task_id to proceed:\n${list}` }],
                        isError: true,
                    };
                }
                targetId = matches[0].id;
                targetContent = matches[0].content;
            }
            // Delete the task
            await todoistClient.deleteTask(targetId);
            return {
                content: [{
                        type: "text",
                        text: `Successfully deleted task: "${targetContent || targetId}"`
                    }],
                isError: false,
            };
        }
        if (name === "todoist_complete_task") {
            if (!isCompleteTaskArgs(args)) {
                throw new Error("Invalid arguments for todoist_complete_task");
            }
            // Determine target task
            let targetId = args.task_id;
            let targetContent = '';
            if (!targetId) {
                if (!args.task_name) {
                    throw new Error("Provide either task_id or task_name");
                }
                const { matches } = await disambiguateByName(args.task_name, args.project_name);
                if (matches.length === 0) {
                    return {
                        content: [{ type: "text", text: `Could not find a task matching "${args.task_name}"${args.project_name ? ` in project "${args.project_name}"` : ''}` }],
                        isError: true,
                    };
                }
                if (matches.length > 1) {
                    const list = matches.slice(0, 10).map(t => `- ${t.content} (id: ${t.id})`).join('\n');
                    return {
                        content: [{ type: "text", text: `Multiple tasks match "${args.task_name}". Please specify task_id to proceed:\n${list}` }],
                        isError: true,
                    };
                }
                targetId = matches[0].id;
                targetContent = matches[0].content;
            }
            // Complete the task
            await todoistClient.closeTask(targetId);
            return {
                content: [{
                        type: "text",
                        text: `Successfully completed task: "${targetContent || targetId}"`
                    }],
                isError: false,
            };
        }
        if (name === "todoist_list_projects") {
            const projects = await todoistClient.getProjects();
            const list = projects.map(p => `- ${p.name} (id: ${p.id})`).join('\n');
            return {
                content: [
                    { type: "text", text: projects.length ? list : "No projects found" },
                    { type: "text", text: `JSON: ${JSON.stringify(projects.map(p => ({ id: p.id, name: p.name })))}` }
                ],
                isError: false,
            };
        }
        if (name === "todoist_list_labels") {
            const labels = await todoistClient.getLabels();
            const list = labels.map(l => `- ${l.name} (id: ${l.id})`).join('\n');
            return {
                content: [
                    { type: "text", text: labels.length ? list : "No labels found" },
                    { type: "text", text: `JSON: ${JSON.stringify(labels.map(l => ({ id: l.id, name: l.name })))}` }
                ],
                isError: false,
            };
        }
        if (name === "todoist_list_sections") {
            const a = request.params.arguments;
            let projectId = a?.project_id;
            if (!projectId && typeof a?.project_name === 'string') {
                projectId = await resolveProjectIdByName(a.project_name);
            }
            const sections = await todoistClient.getSections(projectId);
            const list = sections.map(s => `- ${s.name} (id: ${s.id})${s.projectId ? `\n  ProjectId: ${s.projectId}` : ''}`).join('\n');
            return {
                content: [
                    { type: 'text', text: sections.length ? list : 'No sections found' },
                    { type: 'text', text: `JSON: ${JSON.stringify(sections.map(s => ({ id: s.id, name: s.name, projectId: s.projectId })))}` }
                ],
                isError: false,
            };
        }
        if (name === "todoist_create_section") {
            const a = request.params.arguments;
            if (!a || typeof a.name !== 'string')
                throw new Error('Invalid arguments for todoist_create_section');
            let projectId = a.project_id;
            if (!projectId && typeof a.project_name === 'string') {
                projectId = await resolveProjectIdByName(a.project_name);
            }
            if (!projectId)
                throw new Error('Provide project_id or a valid project_name');
            const section = await todoistClient.addSection({ name: a.name, projectId });
            return {
                content: [
                    { type: 'text', text: `Section created: ${section.name} (id: ${section.id}) in project ${section.projectId}` },
                    { type: 'text', text: `JSON: ${JSON.stringify({ id: section.id, name: section.name, projectId: section.projectId })}` }
                ],
                isError: false,
            };
        }
        if (name === "todoist_create_project") {
            const a = request.params.arguments;
            if (!a || typeof a.name !== 'string')
                throw new Error('Invalid arguments for todoist_create_project');
            let parentId = a.parent_project_id;
            if (!parentId && typeof a.parent_project_name === 'string') {
                parentId = await resolveProjectIdByName(a.parent_project_name);
            }
            const proj = await todoistClient.addProject({ name: a.name, parentId, isFavorite: a.favorite });
            return {
                content: [
                    { type: "text", text: `Project created: ${proj.name} (id: ${proj.id})${proj.parentId ? `\nParentId: ${proj.parentId}` : ''}` },
                    { type: "text", text: `JSON: ${JSON.stringify({ id: proj.id, name: proj.name, parentId: proj.parentId ?? null })}` }
                ],
                isError: false,
            };
        }
        if (name === "todoist_rename_project") {
            const a = request.params.arguments;
            if (!a || typeof a.new_name !== 'string')
                throw new Error('Invalid arguments for todoist_rename_project');
            let projectId = a.project_id;
            if (!projectId && typeof a.project_name === 'string') {
                projectId = await resolveProjectIdByName(a.project_name);
            }
            if (!projectId) {
                throw new Error('Provide project_id or a valid project_name');
            }
            const updated = await todoistClient.updateProject(projectId, { name: a.new_name });
            return {
                content: [
                    { type: "text", text: `Project renamed: ${updated.name} (id: ${updated.id})` },
                    { type: "text", text: `JSON: ${JSON.stringify({ id: updated.id, name: updated.name })}` }
                ],
                isError: false,
            };
        }
        if (name === "todoist_delete_project") {
            const a = request.params.arguments;
            let projectId = a?.project_id;
            if (!projectId && typeof a?.project_name === 'string') {
                projectId = await resolveProjectIdByName(a.project_name);
            }
            if (!projectId) {
                throw new Error('Provide project_id or a valid project_name');
            }
            await todoistClient.deleteProject(projectId);
            return {
                content: [{ type: "text", text: `Project deleted: ${projectId}` }],
                isError: false,
            };
        }
        // Note: no move-task tool because the REST API does not support changing a task's project via updateTask.
        return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
});
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Todoist MCP Server running on stdio");
}
runServer().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
