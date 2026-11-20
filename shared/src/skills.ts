/**
 * Canonical skill dictionary. Keys are canonical names; values are aliases
 * (lowercase) that should map to the canonical name.
 */
export const SKILL_ALIASES: Record<string, string[]> = {
  JavaScript: ["javascript", "js", "es6", "ecmascript"],
  TypeScript: ["typescript", "ts"],
  Python: ["python", "python3"],
  Java: ["java"],
  Go: ["golang", "go lang"],
  Rust: ["rust", "rustlang"],
  "C++": ["c++", "cpp"],
  "C#": ["c#", "csharp", ".net", "dotnet"],
  Ruby: ["ruby"],
  PHP: ["php"],
  Kotlin: ["kotlin"],
  Swift: ["swift"],
  Dart: ["dart"],
  SQL: ["sql"],
  React: ["react", "react.js", "reactjs"],
  "Next.js": ["next.js", "nextjs", "next js"],
  "Vue.js": ["vue", "vue.js", "vuejs"],
  Nuxt: ["nuxt", "nuxt.js"],
  Angular: ["angular", "angularjs"],
  Svelte: ["svelte", "sveltekit"],
  Redux: ["redux"],
  "Tailwind CSS": ["tailwind", "tailwindcss", "tailwind css"],
  HTML: ["html", "html5"],
  CSS: ["css", "css3", "scss", "sass"],
  "Node.js": ["node", "node.js", "nodejs"],
  Express: ["express", "express.js", "expressjs"],
  NestJS: ["nestjs", "nest.js"],
  Fastify: ["fastify"],
  Django: ["django"],
  Flask: ["flask"],
  FastAPI: ["fastapi"],
  Spring: ["spring", "spring boot", "springboot"],
  Rails: ["rails", "ruby on rails"],
  GraphQL: ["graphql", "apollo"],
  REST: ["rest", "rest api", "restful"],
  gRPC: ["grpc"],
  PostgreSQL: ["postgres", "postgresql", "psql"],
  MySQL: ["mysql"],
  MongoDB: ["mongodb", "mongo", "mongoose"],
  Redis: ["redis"],
  SQLite: ["sqlite"],
  Prisma: ["prisma"],
  Drizzle: ["drizzle", "drizzle orm"],
  Elasticsearch: ["elasticsearch", "elastic search", "opensearch"],
  Kafka: ["kafka"],
  RabbitMQ: ["rabbitmq"],
  Docker: ["docker", "containers"],
  Kubernetes: ["kubernetes", "k8s"],
  AWS: ["aws", "amazon web services", "ec2", "s3", "lambda"],
  GCP: ["gcp", "google cloud"],
  Azure: ["azure"],
  Vercel: ["vercel"],
  Terraform: ["terraform"],
  "CI/CD": ["ci/cd", "github actions", "jenkins", "circleci"],
  Linux: ["linux", "bash", "shell scripting"],
  Git: ["git", "github", "gitlab"],
  "Machine Learning": ["machine learning", "ml"],
  "Deep Learning": ["deep learning", "neural networks"],
  PyTorch: ["pytorch", "torch"],
  TensorFlow: ["tensorflow", "keras"],
  "scikit-learn": ["scikit-learn", "sklearn"],
  LLMs: ["llm", "llms", "large language models", "gpt", "claude", "openai", "anthropic"],
  LangChain: ["langchain", "llamaindex"],
  RAG: ["rag", "retrieval augmented generation", "vector database", "pinecone", "pgvector"],
  NLP: ["nlp", "natural language processing"],
  "Computer Vision": ["computer vision", "opencv"],
  Pandas: ["pandas", "numpy"],
  Spark: ["spark", "pyspark"],
  Airflow: ["airflow"],
  "React Native": ["react native", "react-native"],
  Flutter: ["flutter"],
  Android: ["android"],
  iOS: ["ios"],
  Figma: ["figma"],
  Jest: ["jest", "vitest", "mocha"],
  Playwright: ["playwright", "cypress", "selenium"],
  WebSockets: ["websocket", "websockets", "socket.io"],
  Microservices: ["microservices", "microservice"],
  "System Design": ["system design", "distributed systems"],
  "Data Structures": ["data structures", "algorithms", "dsa"],
  Solidity: ["solidity", "web3", "ethereum"],
};

const aliasIndex: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
    m.set(canonical.toLowerCase(), canonical);
    for (const a of aliases) m.set(a, canonical);
  }
  return m;
})();

export function normalizeSkill(raw: string): string {
  const key = raw.trim().toLowerCase();
  return aliasIndex.get(key) ?? raw.trim();
}

export function normalizeSkills(raw: string[]): string[] {
  const out = new Set<string>();
  for (const s of raw) {
    if (!s || !s.trim()) continue;
    out.add(normalizeSkill(s));
  }
  return [...out];
}

/**
 * Aliases that are ordinary English words or very short. Inside free text they
 * only count when written in their usual technical casing (e.g. "Go", "Rust",
 * "REST", "Node"), never lowercase prose ("go to", "rest of").
 */
const CASE_SENSITIVE: Record<string, string[]> = {
  Go: ["Go", "Golang"],
  Rust: ["Rust"],
  Java: ["Java"],
  Ruby: ["Ruby"],
  Swift: ["Swift"],
  Dart: ["Dart"],
  Spark: ["Spark", "PySpark"],
  Flask: ["Flask"],
  Spring: ["Spring", "Spring Boot"],
  Express: ["Express", "Express.js", "ExpressJS"],
  "Node.js": ["Node", "Node.js", "NodeJS"],
  REST: ["REST", "RESTful", "REST API"],
  Git: ["Git", "GitHub", "GitLab"],
  iOS: ["iOS"],
  "Machine Learning": ["ML", "Machine Learning"],
  JavaScript: ["JS", "JavaScript"],
  TypeScript: ["TS", "TypeScript"],
  Redux: ["Redux"],
  "C#": ["C#", ".NET"],
  "C++": ["C++"],
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const patternCache = new Map<string, RegExp>();
function boundedRegex(alias: string, flags: string): RegExp {
  const key = `${flags}:${alias}`;
  let re = patternCache.get(key);
  if (!re) {
    // boundaries that tolerate symbols like "c++" and "next.js"
    re = new RegExp(`(^|[^A-Za-z0-9+#.])${escapeRe(alias)}(?![A-Za-z0-9+#])`, flags);
    patternCache.set(key, re);
  }
  return re;
}

const SAFE_ALIASES: Record<string, string[]> = Object.fromEntries(
  Object.entries(SKILL_ALIASES).map(([canonical, aliases]) => {
    const all = [canonical.toLowerCase(), ...aliases];
    const caseSensitive = new Set((CASE_SENSITIVE[canonical] ?? []).map((a) => a.toLowerCase()));
    return [canonical, all.filter((a) => !caseSensitive.has(a) && a.length > 2)];
  }),
);

/** Extract canonical skills mentioned in free text. */
export function extractSkills(text: string): string[] {
  const found = new Set<string>();
  for (const canonical of Object.keys(SKILL_ALIASES)) {
    if (SAFE_ALIASES[canonical].some((a) => boundedRegex(a, "i").test(text))) {
      found.add(canonical);
      continue;
    }
    const cs = CASE_SENSITIVE[canonical];
    if (cs && cs.some((a) => boundedRegex(a, "").test(text))) found.add(canonical);
  }
  return [...found];
}

/** Skills that imply related skills, used for partial credit in matching. */
export const RELATED_SKILLS: Record<string, string[]> = {
  "Next.js": ["React", "TypeScript", "JavaScript"],
  React: ["JavaScript", "Next.js"],
  TypeScript: ["JavaScript"],
  "Node.js": ["JavaScript", "Express", "TypeScript"],
  Express: ["Node.js"],
  NestJS: ["Node.js", "TypeScript"],
  PostgreSQL: ["SQL", "MySQL"],
  MySQL: ["SQL", "PostgreSQL"],
  PyTorch: ["TensorFlow", "Deep Learning", "Python"],
  TensorFlow: ["PyTorch", "Deep Learning", "Python"],
  LLMs: ["RAG", "LangChain", "NLP"],
  RAG: ["LLMs", "LangChain"],
  "Vue.js": ["React", "Nuxt"],
  Docker: ["Kubernetes"],
  Kubernetes: ["Docker"],
  AWS: ["GCP", "Azure"],
  "React Native": ["React", "Flutter"],
  Flutter: ["React Native", "Dart"],
};
