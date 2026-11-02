# Plano incremental: modularidade do RAG e da plataforma

Status: proposta de trabalho. O RAG vem primeiro; as demais áreas serão planejadas em detalhe depois que ele estiver estabilizado. Cada etapa é independente, revisável e deve manter os testes anteriores passando.

## Objetivos e limites

- Preservar os contratos HTTP e CLI, respostas, estratégias e regras existentes, salvo mudança aprovada explicitamente.
- Manter Ollama (`llama3` e `nomic-embed-text`), Chroma, BM25 e RRF como padrão enquanto outros provedores são avaliados.
- Concentrar a composição de dependências por processo, no estilo de registro do .NET, sem impor uma biblioteca de DI se funções e classes simples forem suficientes.
- Criar contratos pequenos para necessidades reais; evitar interfaces especulativas, código duplicado e renomeações cosméticas.
- Não migrar para pgvector, nuvem ou PydanticAI automaticamente. Mudanças de provedor exigem avaliação, configuração e eventualmente migração ou reindexação.

## Etapa 0 — Inventário e linha de base do RAG

- Mapear pontos de entrada HTTP, CLI e avaliação, dependências externas, dados locais, caches e contratos públicos atuais.
- Executar a suíte unitária, medir cobertura e registrar os testes de integração disponíveis com Ollama e Chroma. Identificar lacunas por comportamento, não apenas por percentual.
- Registrar o comportamento atual das estratégias, RRF, metadados, mensagens de erro, índice e prompts. Guardar evidências antes de alterações.

**Aceite:** resultados reproduzíveis; casos críticos e lacunas documentados; dados reais e índices existentes preservados.

## Etapa 1 — Composição e ciclo de vida

- Revisar a composição já existente (`RagService`, factory e providers) e decidir o ponto de registro do servidor e da CLI. Evitar múltiplos fallbacks concretos espalhados pelas regras.
- Injetar as dependências necessárias no fluxo completo de resposta, recuperação, streaming e ingestão, sem quebrar os pontos de entrada legados.
- Definir criação, cache, fechamento e invalidação das instâncias e do índice; permitir doubles em testes.

**Aceite:** testes HTTP e CLI com dependências falsas e sem inicializar Chroma; implementações padrão preservadas; erros de configuração explícitos.

## Etapa 2 — Contrato de embeddings

- Extrair somente as operações necessárias para gerar embeddings de documento e pergunta. Adaptar o provider Ollama existente, preservando prefixos de `nomic-embed-text`.
- Compor o mesmo provider na ingestão e na busca; testar erros, parâmetros e compatibilidade de vetores.
- Registrar modelo e dimensões no índice; detectar incompatibilidades e exigir reindexação quando necessário.

**Aceite:** Ollama continua produzindo os mesmos embeddings para as mesmas entradas; fake substituível; índice incompatível não é usado silenciosamente.

## Etapa 3 — Contrato de geração

- Separar as chamadas de geração, reescrita e eventual HyDE das regras de recuperação, preservando prompts, histórico, configuração, timeouts e tratamento de falhas.
- Adaptar `ChatOllama` como implementação padrão e injetar um fake determinístico nos testes.
- Examinar a chamada ao Ollama do backend TypeScript separadamente: não assumir que a interface Python cobre o outro processo.

**Aceite:** formato e regras das respostas preservados; testes de sucesso, timeout, falha e histórico; comparações de qualidade executadas antes de trocar modelo.

## Etapa 4 — Chunks, busca lexical e armazenamento vetorial

- Definir contrato mínimo para ler chunks por índice/versão e strategy; manter JSON local como implementação inicial.
- Verificar o contrato `VectorStore` atual: operações de leitura/escrita, identidade dos chunks e limites de uso de APIs privadas do Chroma.
- Testar consistência entre chunks lexicais e vetores, atualização, exclusão, falhas e caches após reingestão.
- Manter BM25/RRF existentes; não substituir BM25 por busca textual PostgreSQL sem avaliar diferenças.

**Aceite:** retrieval híbrido funciona com adaptadores falsos e padrão; índice e chunks não ficam inconsistentes silenciosamente; cobertura dos casos de erro.

## Etapa 5 — Prova de conceito PostgreSQL + pgvector

- Opcional, depois das etapas anteriores: armazenar documentos, versões, chunks e embeddings com identidade estável; implementar adaptadores de PostgreSQL/pgvector.
- Comparar qualidade de retrieval e respostas, latência, custo e operação com a referência Chroma/BM25. A pesquisa textual nativa do PostgreSQL não é equivalente automaticamente a BM25.
- Planejar transações, reindexação e isolamento por clínica antes de dados reais. A prova de conceito não substitui o backend padrão sem decisão explícita.

**Aceite:** testes de contrato e comparação documentada; escolha informada sobre adoção ou rejeição.

## Etapa 6 — Nomes e estrutura, após estabilizar o RAG

- Inventariar diretórios, nomes de experimentos e dados herdados de RagLab/DentalSafe; propor nomes que expressem responsabilidades reais e diferenciem produto, avaliação e fixtures.
- Renomear em mudança própria, apenas depois dos contratos estabilizados. Atualizar imports, CLI, caminhos persistidos, documentação e scripts; preservar migração ou compatibilidade quando houver consumidores reais.

**Aceite:** caminhos e comandos existentes avaliados, migração definida para dados persistidos e testes completos verdes. Nenhuma renomeação cosmética agora.

## Etapa 7 — Backend e produto, em planejamento posterior

- Avaliar separadamente composição/contratos no TypeScript para WhatsApp, calendário, persistência, modelo e RAG. Priorizar acoplamentos reais e regras duplicadas.
- Substituir nome, prompt e dados fixos da DentalSafe por configuração e perfis de clínica/especialidade, preservando regras e testes.
- Antes de mais de uma clínica: autenticação, isolamento de dados, configuração por clínica, logs, backups e validação das regras para dados sensíveis.
- Só depois planejar piloto em nuvem, benchmarks de custo/latência e escolha entre VM e serviços gerenciados.

## PydanticAI — avaliação opcional, não uma dependência do plano

O framework pode ser avaliado em uma prova de conceito isolada para saídas estruturadas, ferramentas e troca de provedores, inclusive Ollama. Comparar com a implementação atual em qualidade, latência, dependências, observabilidade e esforço de manutenção. Não reescrever o RAG nem substituir regras determinísticas de agendamento por agentes sem evidências e decisão explícita.

## Regras de execução e evidências

- Para comportamento existente, escrever e executar testes de caracterização antes da refatoração; eles devem passar antes de mover o código. Para bug ou funcionalidade nova, demonstrar RED causado pelo comportamento pretendido antes do GREEN.
- Executar a suíte relevante a cada etapa; reservar testes reais de Ollama/Chroma e avaliação de qualidade para mudanças que possam afetar integração ou respostas. Registrar comandos, resultados, cobertura e limitações sem inventar resultados.
- Fazer checkpoint Git de cada etapa quando aplicável, isolando mudanças próprias e preservando alterações anteriores do usuário.

## Estado atual (2026-10-30)

A versão canônica e atualizada deste plano está no ai-memory: `plans/rag-and-platform-modularity.md` (inclui a decisão de uma clínica por instalação e o relatório da linha de base: 412 testes, 88% de cobertura, lacunas por módulo). Este arquivo mantém o detalhamento original; a numeração do ai-memory é 1 a 7, e a "Etapa 0" daqui equivale à Etapa 1 de lá.
