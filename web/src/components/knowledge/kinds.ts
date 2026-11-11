// Chaves do namespace knowledge para os nomes dos tipos de seção (lista, botões e títulos do diálogo).

/** Nome do tipo de seção nas linhas da lista. */
export const KIND_LABEL_KEY = { treatment: "kind.treatment", info: "kind.info", clinic: "kind.clinic" } as const;

/** Botão "Adicionar ..." de cada tipo, e o título do diálogo ao criar. */
export const KIND_ADD_KEY = { treatment: "add.treatment", info: "add.info", clinic: "add.clinic" } as const;

/** Título do diálogo ao editar uma seção do tipo. */
export const KIND_EDIT_KEY = { treatment: "edit.treatment", info: "edit.info", clinic: "edit.clinic" } as const;

/** Frase de ajuda do diálogo para o tipo. */
export const KIND_DESCRIBE_KEY = { treatment: "describe.treatment", info: "describe.info", clinic: "describe.clinic" } as const;
