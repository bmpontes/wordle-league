# Listas de palavras (não publicadas)

Coloque aqui, **apenas na máquina local**, as listas de palavras reais a importar no painel
(**Admin → Palavras**). O conteúdo desta pasta está no `.gitignore` e **nunca** deve ir para o GitHub:
a lista de palavras secretas revelaria as respostas a qualquer pessoa.

| Lista | Para que serve | Sugestão de ficheiro |
|---|---|---|
| Palavras secretas | Palavra do dia (uma por dia, sem repetições) | `secret-words.txt` |
| Palavras aceites | Validação das tentativas (quanto maior, melhor) | `accepted-words.txt` |

Formato: TXT (uma palavra por linha) ou CSV (primeira coluna, cabeçalho opcional `palavra`), UTF-8.
Exemplos de formato em [`examples/`](../examples/).
