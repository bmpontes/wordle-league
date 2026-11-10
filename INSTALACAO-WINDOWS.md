# Instalação em Windows (sem Docker)

Este guia instala a Wordle League num Windows 10/11 ou Windows Server. A aplicação passa a arrancar sozinha com o Windows, reinicia se falhar e faz um backup diário. Demora cerca de 10 minutos.

**Requisitos**
- Conta com permissões de **administrador** na máquina.
- **Acesso à Internet** durante a instalação. O Node.js e as dependências são descarregados de `nodejs.org`, `registry.npmjs.org` e `github.com`. Depois de instalada, a aplicação não precisa de Internet.

> **Instalações existentes:** se a aplicação já está instalada noutra pasta (por exemplo `C:\ForenseWordleLeague`), continue a usar essa pasta em todos os comandos. Os nomes internos das tarefas (`ForenseWordleLeague`, `ForenseWordleLeague-Backup`) e da regra de firewall mantêm-se.

---

## 1. Instalar o Node.js

1. Descarregue o **Node.js 24 LTS**, versão *Windows Installer (.msi)*, em https://nodejs.org.
2. Instale com as opções por omissão. **Não** é preciso marcar *"Tools for Native Modules"*.
3. Abra uma **nova** janela do PowerShell e confirme:
   ```powershell
   node -v      # deve mostrar v24.x.x (mínimo v22.9)
   ```

## 2. Obter a aplicação

Coloque o código numa pasta fixa, por exemplo `C:\WordleLeague`. Há duas formas:

- **Com git:**
  ```powershell
  git clone https://github.com/bmpontes/FOR_Wordle_League.git C:\WordleLeague
  ```
- **Sem git:** no GitHub, use **Code → Download ZIP** (ou o ZIP da versão fornecido pela secção) e extraia o conteúdo para `C:\WordleLeague`.

Não use o Ambiente de Trabalho nem a pasta Transferências. A aplicação corre com a conta de sistema, e a base de dados fica em `C:\WordleLeague\data`.

## 3. Executar o instalador

Abra o **PowerShell como Administrador** (botão direito → *Executar como administrador*) e execute:

```powershell
cd C:\WordleLeague
powershell -ExecutionPolicy Bypass -File .\windows\instalar.ps1
```

Para usar outra porta em vez da 3000, acrescente `-Porta 8080`.

O instalador:
1. confirma a versão do Node.js;
2. instala as dependências;
3. cria o ficheiro `.env`;
4. **pergunta se quer criar o administrador** (responda `S`, escolha o nome de utilizador e uma password de 10 ou mais caracteres; a password não aparece no ecrã);
5. abre a porta na firewall (redes de domínio e privadas);
6. regista as tarefas `ForenseWordleLeague` e `ForenseWordleLeague-Backup`;
7. inicia a aplicação e mostra os endereços de acesso.

## 4. Primeira configuração

1. Num browser, abra `http://<nome-da-máquina>:3000` e entre com o administrador.
2. Vá a **Admin → Palavras** e importe as listas de palavras:
   - **Palavras secretas**: a lista com as palavras do dia;
   - **Palavras aceites**: a lista de validação (por exemplo, a lista de tentativas do Wordle).

   As listas reais **não estão no GitHub**, para não revelar as respostas. Copie-as para a pasta `listas\` da máquina, ou importe-as de onde as tiver. Os formatos estão em `examples\`.
3. Em **Admin → Estado**, confirme que não há avisos.
4. Crie as contas da equipa em **Admin → Utilizadores**. Em alternativa, deixe o registo aberto e cada pessoa cria a sua conta; depois pode desativar o registo em **Parâmetros**.
5. Em **Admin → Personalização**, defina o nome do jogo, o subtítulo, o rodapé, o logótipo e, se quiser, a imagem da página `/ranking`.
6. Abra a classificação para o ecrã da equipa em `http://<nome-da-máquina>:3000/ranking`.

---

## Operação diária

Execute estes comandos no PowerShell, dentro de `C:\WordleLeague`. Os comandos que alteram o estado exigem PowerShell como Administrador.

| Ação | Comando |
|---|---|
| Ver o estado | `powershell -ExecutionPolicy Bypass -File .\windows\servico.ps1 -Acao estado` |
| Ver o registo (últimas 50 linhas) | `... servico.ps1 -Acao registo` |
| Parar / iniciar / reiniciar | `... servico.ps1 -Acao parar` · `iniciar` · `reiniciar` |
| Backup manual | `powershell -ExecutionPolicy Bypass -File .\windows\backup.ps1` |
| Criar outro administrador | `npm run create-admin` |

**Backups:** são feitos todos os dias às 03:00 para `data\backups\` e guardados durante 30 dias. Para guardar também uma cópia fora da máquina, edite a tarefa `ForenseWordleLeague-Backup` no Agendador de Tarefas e acrescente `-CopiarPara \\servidor\partilha\wordle` aos argumentos.

**Restaurar um backup:**
```powershell
.\windows\servico.ps1 -Acao parar
node scripts\restore.js data\backups\wordle-AAAAMMDD-HHMMSS.sqlite --yes
.\windows\servico.ps1 -Acao iniciar
```

**Atualizar para uma nova versão:**
1. Na pasta da aplicação, faça `git pull`. Sem git, copie os ficheiros novos por cima. **Nunca apague `data\` nem `.env`.**
2. Execute como Administrador:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\windows\atualizar.ps1
   ```
   O script faz um backup antes de atualizar.

**Desinstalar:** `powershell -ExecutionPolicy Bypass -File .\windows\desinstalar.ps1` remove as tarefas e a regra de firewall, mas mantém os dados. Para remover tudo, apague depois a pasta.

---

## Resolução de problemas

| Sintoma | O que verificar |
|---|---|
| `node` não é reconhecido | Feche e reabra o PowerShell depois de instalar o Node.js. |
| `npm ci` falha | Acesso à Internet ou proxy. Se houver proxy, configure-o com `npm config set proxy http://proxy:porta` e `npm config set https-proxy http://proxy:porta`. |
| Funciona na própria máquina mas não noutros PCs | Firewall: a regra só cobre redes de **Domínio** e **Privadas**. Se a rede estiver classificada como *Pública*, altere a classificação ou a regra *Wordle League*. |
| A página não abre | Veja `servico.ps1 -Acao estado` e `-Acao registo` (o ficheiro de registo é `data\logs\server.log`). |
| A porta 3000 já está ocupada | Edite `PORT=` no `.env`, volte a correr `instalar.ps1 -Porta <nova>` e reinicie. |
| Esqueceu-se da password de administrador | Crie outro administrador com `npm run create-admin` e redefina a password no painel. |

**Segurança:** a aplicação é servida por HTTP na rede interna. Para usar HTTPS, veja a secção "Reverse proxy Nginx e HTTPS" do `README.md` ou coloque-a atrás de um proxy HTTPS já existente na organização. Nesse caso, defina `COOKIE_SECURE=true` e `TRUST_PROXY=1` no `.env`.
