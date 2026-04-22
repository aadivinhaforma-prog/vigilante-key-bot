INSTRUÇÃO MESTRE DE ATUALIZAÇÃO - VIGILANTE KEY BOT
OWNER_ID (dono do bot) = 1467333025430900860
Este é o ID do Discord do dono. Apenas esse ID pode usar os comandos /owner.

================================================================================
PARTE 1 — CORREÇÃO DE ERROS (YOUTUBE, INSTAGRAM E TIKTOK)
================================================================================
Explicação: O bot às vezes mostra a mensagem "❌ Não consegui analisar este vídeo" mesmo quando o link está correto. Isso precisa ser corrigido nas três plataformas.

1. ATUALIZAR yt-dlp AUTOMATICAMENTE
O que fazer: Toda vez que o bot ligar, rodar o comando "pip install -U yt-dlp" automaticamente antes de qualquer coisa. Isso garante que a biblioteca de download esteja sempre na versão mais recente. YouTube, TikTok e Instagram mudam suas regras com frequência e uma versão antiga do yt-dlp para de funcionar.

2. LIMPEZA DE LINKS DO INSTAGRAM E TIKTOK
O que fazer: Antes de tentar baixar qualquer vídeo do Instagram ou TikTok, remover tudo que aparecer depois do "?" no link. Exemplo: "instagram.com/reel/abc123?igsh=xyz" vira "instagram.com/reel/abc123". Esses dados depois do "?" são rastreadores que podem causar erros no download.

3. SEGUNDA TENTATIVA AUTOMÁTICA
O que fazer: Se o download falhar na primeira tentativa, esperar 3 segundos e tentar uma segunda vez automaticamente. Só mostrar mensagem de erro para o usuário se as duas tentativas falharem.

4. INVESTIGAR E CORRIGIR O ERRO GENÉRICO
O que fazer: O bot está mostrando sempre a mesma mensagem de erro genérica. O desenvolvedor deve verificar:
- Se o yt-dlp está desatualizado (causa mais comum do problema)
- Se o YouTube está bloqueando o bot
- Se o Instagram está pedindo login para acessar
- Se o TikTok mudou alguma coisa na API
Adicionar registros detalhados no terminal para mostrar o erro real.

5. MENSAGENS DE ERRO MAIS CLARAS
Em vez de sempre mostrar a mesma mensagem de erro, identificar o motivo real:
- Link errado → "❌ Link inválido. Verifique e tente novamente."
- Vídeo apagado → "❌ Este vídeo está privado, removido ou indisponível."
- Site fora do ar → "❌ Plataforma temporariamente indisponível. Tente em alguns minutos."
- Problema de internet → "❌ Erro de conexão. Tentando novamente..."

6. CORRIGIR BUG DO LINK DE MÚSICA NO BOTÃO FALSE
Quando o usuário clica no botão FALSE (que faz só a análise sem baixar o vídeo), o link da música detectada não está aparecendo. Isso é um bug. O link da música deve aparecer SEMPRE, tanto no botão TRUE quanto no botão FALSE.

================================================================================
PARTE 2 — SISTEMA DE FICHAS
================================================================================
Explicação: Ficha é o que o usuário gasta para baixar um vídeo. Cada usuário tem um estoque de fichas que se recarrega com o tempo.

7. ESTOQUE DE FICHAS
Cada usuário começa com 3 fichas. Cada vez que baixa um vídeo, gasta 1 ficha. As fichas são identificadas pelo ID do Discord de cada pessoa.

8. INTERVALO ENTRE FICHAS
Depois de usar a 1ª ficha, o usuário precisa esperar 1 hora antes de usar a 2ª ficha. Isso evita que a pessoa baixe vários vídeos em sequência muito rápida.

9. RECARGA DAS FICHAS
Depois que o usuário usar as 3 fichas, o estoque só volta ao normal após 7 dias (168 horas).

10. PRIVACIDADE
O bot salva APENAS o ID do Discord de cada usuário no arquivo database.json. É PROIBIDO salvar qualquer outra informação como IP, nome, e-mail ou qualquer dado pessoal.

11. CONFIRMAÇÃO ANTES DE GASTAR A FICHA
Antes de gastar a ficha, o bot mostra uma mensagem perguntando se o usuário quer confirmar, mostrando quantas fichas a pessoa ainda tem. Exemplo: "Confirmar esse vídeo? (Estoque: 2/3 fichas)" com dois botões: ✅ Confirmar e ❌ Cancelar. A ficha só é descontada se o usuário clicar em Confirmar.

12. AVISO DE FICHA BAIXA
Quando o usuário tiver apenas 1 ficha restante, o bot avisa automaticamente: "⚠️ Atenção: você tem apenas 1 ficha restante!"

13. COMANDO /fichas
Novo comando que o usuário pode usar para ver quantas fichas tem e quanto tempo falta para o reset. Usar esse comando não gasta nenhuma ficha.

================================================================================
PARTE 3 — REGRAS E SEGURANÇA
================================================================================

14. TRAVA DE LIVES
Se o usuário mandar o link de uma transmissão ao vivo, o bot recusa: "❌ Não baixo transmissões ao vivo. Tente quando o vídeo estiver gravado." Ninguém pode desativar isso.

15. FILTRO DE CONTEÚDO PROIBIDO
Se o título do vídeo tiver palavras relacionadas a violência ou conteúdo adulto, o bot recusa o download para não quebrar as regras do Discord.

16. MARCA D'ÁGUA OBRIGATÓRIA
O bot usa FFmpeg para gravar o @ do criador original no canto do vídeo. ESTA FUNÇÃO NUNCA PODE SER DESATIVADA POR NINGUÉM. Todo vídeo baixado sai com o @ gravado. Se a marca d'água falhar, o bot CANCELA o envio: "❌ Não foi possível adicionar a marca d'água. O vídeo não será enviado para proteger o criador original."

17. LIMITE DE TAMANHO DO VÍDEO
O Discord não aceita arquivos acima de 25MB. Se o vídeo for maior, o bot manda apenas o link do vídeo em texto.

18. VALIDAÇÃO DO LINK
Antes de fazer qualquer coisa, o bot verifica se o link é válido. Se não for: "❌ Link inválido. Verifique e tente novamente."

19. PLATAFORMAS PERMITIDAS
O bot só aceita links do YouTube, TikTok e Instagram. Qualquer outro site: "❌ Plataforma não suportada. Use links do YouTube, TikTok ou Instagram."

20. VÍDEO MUITO CURTO
O bot recusa vídeos com menos de 3 segundos de duração.

21. VÍDEO MUITO LONGO
O bot recusa vídeos acima de 10 minutos para evitar arquivos gigantes.

22. PROTEÇÃO ANTI-SPAM
Se o mesmo usuário tentar usar o bot 5 vezes em menos de 1 minuto, o bot bloqueia essa pessoa por 10 minutos.

23. BLOQUEAR LINKS ENCURTADOS
O bot não aceita links encurtados como bit.ly ou tinyurl.

24. LINK DUPLICADO
Se o mesmo usuário mandar o mesmo link duas vezes seguidas: "⚠️ Você já analisou esse vídeo recentemente."

25. IGNORAR OUTROS BOTS
Se outro bot tentar usar o Vigilante Key, ele ignora completamente.

26. APENAS EM SERVIDORES
O bot não funciona em DM do Discord. Só funciona dentro de servidores.

27. BLOQUEAR SITES ADULTOS
Qualquer link de site adulto é bloqueado imediatamente.

28. LOG DE ERROS INTERNO
O bot salva erros técnicos num arquivo logs.txt. NUNCA salvar dados de usuários nesse arquivo.

================================================================================
PARTE 4 — PROTEÇÃO PARA O BOT NÃO SER BANIDO DO DISCORD
================================================================================
Explicação: Essas regras protegem o bot de ser banido pela equipe do Discord por uso abusivo.

29. LIMITE DIÁRIO POR SERVIDOR
Máximo de 50 downloads por dia em cada servidor. Se atingir: "❌ Limite diário do servidor atingido. Tente amanhã."

30. DELAY OBRIGATÓRIO ENTRE COMANDOS
O bot espera obrigatoriamente 5 segundos entre um comando e outro. Evita uso muito rápido que chama atenção do Discord.

31. TRAVA AUTOMÁTICA POR USO SUSPEITO
Se o bot detectar uso suspeito em massa, para automaticamente por 1 hora e avisa o dono do servidor.

32. LIMITE DE DOWNLOADS SIMULTÂNEOS
Máximo de 3 downloads ao mesmo tempo em todo o servidor. Os próximos ficam na fila.

33. REGISTRO DE HORÁRIOS
O bot registra o horário de cada download para identificar padrões suspeitos.

34. VERIFICAÇÃO DE COPYRIGHT
Se o vídeo tiver bloqueio de direitos autorais, o bot recusa o download.

35. CRIADORES COM POUCOS INSCRITOS
O bot não baixa vídeos de criadores com menos de 100 inscritos.

36. LIMITE DE DOWNLOADS DO MESMO CRIADOR
Cada usuário pode baixar no máximo 3 vídeos do mesmo criador por semana. Se tentar mais: "❌ Você já baixou 3 vídeos desse criador essa semana. Aguarde para baixar mais."

================================================================================
PARTE 5 — EXPERIÊNCIA DO USUÁRIO
================================================================================

37. MENSAGEM DE PROCESSANDO
Enquanto o bot trabalha, mostrar "⏳ Analisando seu vídeo..." para o usuário não achar que travou.

38. DETECÇÃO AUTOMÁTICA DA PLATAFORMA
O bot detecta sozinho se o link é do YouTube, TikTok ou Instagram.

39. THUMBNAIL ANTES DE CONFIRMAR
Antes de confirmar o download, o bot mostra a imagem de capa do vídeo.

40. TAMANHO DO ARQUIVO ANTES DE CONFIRMAR
Antes de confirmar, o bot informa o tamanho estimado do arquivo.

41. TIMEOUT DE 60 SEGUNDOS
Se demorar mais de 60 segundos, o bot cancela e avisa o usuário.

42. BARRA DE PROGRESSO
Enquanto o vídeo está sendo baixado, mostrar uma barra de progresso animada.

43. TUDO EM PORTUGUÊS
Todas as mensagens em português brasileiro, amigável e natural.

44. ERROS EXPLICADOS
Quando der erro, explicar claramente o que aconteceu e o que o usuário pode fazer.

45. COMANDO /ajuda
Mostra como usar o bot com exemplos de links válidos de cada plataforma.

46. COMANDO /historico
Mostra os últimos 5 vídeos que o usuário analisou. Salvar apenas título e plataforma, sem dados pessoais.

47. COMANDO /top
Mostra os 3 vídeos com maior chance de viralizar analisados no servidor durante a semana.

48. COMANDO /perfil
Mostra o perfil do usuário: fichas restantes, conquistas desbloqueadas e total de vídeos baixados.

================================================================================
PARTE 6 — GAMIFICAÇÃO
================================================================================
Explicação: Sistema de recompensas para motivar os usuários.

49. CONQUISTAS
O bot desbloqueia conquistas conforme o usuário baixa vídeos:
- "Iniciante 🎬" — desbloqueada no 1º vídeo
- "Analista 📊" — desbloqueada no 10º vídeo
- "Expert 🏆" — desbloqueada no 50º vídeo
- "Lendário 👑" — desbloqueada no 100º vídeo

50. RANKING DO SERVIDOR
Comando /ranking mostra quem mais baixou vídeos no servidor no mês atual.

51. FICHAS BÔNUS POR FIDELIDADE
Usuários que usam o bot há mais de 30 dias ganham +1 ficha bônus por semana.

52. CONTADOR GERAL DO SERVIDOR
Mostra quantos vídeos já foram analisados no total dentro do servidor.

================================================================================
PARTE 7 — VIRALPREDICTOR
================================================================================
Explicação: Função que calcula a chance de um vídeo viralizar e mostra numa barra de porcentagem.

53. LEITURA DO HISTÓRICO DO CANAL
O bot lê os vídeos antigos e comentários do canal para entender o padrão daquele criador, tornando a porcentagem mais precisa.

54. COMPARAÇÃO COM VÍDEOS VIRAIS DA SEMANA
O bot compara o vídeo com outros que estão viralizando na mesma semana e plataforma.

================================================================================
PARTE 8 — COMANDOS DO ADMINISTRADOR DO SERVIDOR (/adm)
================================================================================
Explicação: Só quem tem cargo de Administrador ou permissão "Gerenciar Servidor" pode usar. Se outra pessoa tentar: "❌ Você não tem permissão para usar esse comando."

55. /adm-banir @usuario
Bane um usuário de usar o bot naquele servidor. O banimento é apenas naquele servidor.

56. /adm-desbanir @usuario
Remove o banimento de um usuário.

57. /adm-fichas @usuario [número]
Adiciona fichas para um usuário específico do servidor.

58. /adm-resetar @usuario
Reseta as fichas de um usuário na hora, sem esperar os 7 dias.

59. /adm-canal #canal
Define em qual canal do Discord o bot pode ser usado. Em outros canais o bot ignora.

60. /adm-log
Mostra log privado com downloads do servidor. Apenas ID e horário, sem dados pessoais.

61. /adm-limite [número]
Muda o limite diário de downloads do servidor. Padrão é 50.

62. /adm-status
Resumo do dia: downloads feitos, usuários bloqueados e fichas usadas.

63. /adm-destino [opção]
O ADM escolhe onde o bot entrega o resultado:
- /adm-destino servidor — responde no canal onde o usuário digitou (padrão)
- /adm-destino canal #nome — sempre entrega num canal específico independente de onde o usuário digitou
- /adm-destino dm — envia tudo no privado de cada usuário, mantendo o servidor limpo
Após configurar, o bot envia uma mensagem de teste no destino escolhido para confirmar que está funcionando.
Se o destino for DM mas o usuário tiver o privado fechado: "⚠️ Não consegui te enviar no privado. Abra suas DMs e tente novamente."

64. /adm-bloquear-criador [link do criador]
ATENÇÃO: Bloqueia um CRIADOR do YouTube, TikTok ou Instagram. Não tem nada a ver com canais do Discord. Ninguém naquele servidor consegue baixar vídeos daquele criador.

65. /adm-bloquear-video [link do vídeo]
Bloqueia apenas um vídeo específico no servidor.

66. /adm-desbloquear-criador [link]
Remove o bloqueio de um criador.

67. /adm-desbloquear-video [link]
Remove o bloqueio de um vídeo.

68. /adm-lista-bloqueios
Lista todos os criadores e vídeos bloqueados no servidor.

69. /adm-desfazer [número]
Desfaz as últimas ações do ADM. O número pode ser qualquer valor que o ADM quiser. Exemplos:
- /adm-desfazer 1 → desfaz a última ação
- /adm-desfazer 4 → desfaz as últimas 4 ações
- /adm-desfazer tudo → desfaz tudo das últimas 24 horas
PRAZO: Só funciona para ações das últimas 24 horas.

================================================================================
PARTE 9 — COMANDOS SECRETOS DO DONO (/owner)
================================================================================
Explicação: Exclusivos do dono (ID: 1467333025430900860). Nenhum outro usuário vê ou usa esses comandos. Se alguém tentar, o bot não responde nada.

HIERARQUIA:
- Usuário comum → usa o bot com fichas
- ADM do servidor → controla o bot no próprio servidor
- Dono do bot → controle total em todos os servidores

--- GERENCIAMENTO DE ADMINS ---

70. /owner-addadmin [ID]
Dá poderes de admin do bot para uma pessoa. Ela passa a ter os mesmos poderes que você em todos os servidores.

71. /owner-removeadmin [ID]
Remove os poderes de admin de uma pessoa. Nenhum admin pode remover outro. Nenhum admin pode remover você. Se tentarem: "❌ Você não pode remover o dono do bot."

72. /owner-listar-admins
Lista todas as pessoas com poderes de admin, com nome e ID de cada uma.

--- CONTROLE GERAL ---

73. /owner-banir
Parâmetros:
- usuario_id (OBRIGATÓRIO) — ID da pessoa para banir permanentemente de todos os servidores
- motivo (OPCIONAL) — motivo do banimento

74. /owner-desbanir
Parâmetros:
- usuario_id (OBRIGATÓRIO) — ID da pessoa para remover o banimento

75. /owner-mensagem
Parâmetros:
- texto (OBRIGATÓRIO) — mensagem que vai ser enviada
- servidor_id (OPCIONAL) — ID do servidor específico. Se não preencher envia para TODOS os servidores automaticamente

76. /owner-resetar
Parâmetros:
- usuario_id (OPCIONAL) — ID de um usuário específico para resetar só ele
- servidor_id (OPCIONAL) — ID de um servidor específico para resetar só ele
- Se não preencher nenhum dos dois → reseta TUDO de todos os servidores

79. /owner-desligar
Desliga o bot em todos os servidores. Avisa: "⚙️ Bot em manutenção. Voltamos em breve!"

80. /owner-ligar
Liga o bot novamente após manutenção.

81. DENÚNCIAS NO PRIVADO
Toda denúncia de qualquer servidor chega no seu privado com todos os detalhes.

--- CONTROLE DE FICHAS ---

82. /owner-fichas-custom [ID] [número]
Muda as fichas de um usuário específico para qualquer número que você quiser.

83. /owner-fichas-global [número]
Muda as fichas padrão de TODOS os usuários de todos os servidores.

84. /owner-tempo-custom [ID] [horas]
Muda o tempo de espera entre fichas de um usuário específico.

85. /owner-tempo-global [horas]
Muda o tempo de espera entre fichas de TODOS os usuários.

86. /owner-reset-custom [ID]
Reseta as fichas de um usuário específico na hora.

87. /owner-reset-global
Reseta as fichas de TODOS os usuários de todos os servidores.

88. /owner-dias-custom [ID] [dias]
Muda o tempo de recarga de 7 dias para um usuário específico.

89. /owner-dias-global [dias]
Muda o tempo de recarga para TODOS os usuários.

90. /owner-config [ID]
Comando que abre um painel completo de configuração para um usuário específico. Em vez de usar vários comandos separados, esse comando mostra tudo numa tela só com botões para você escolher o que quer mudar. O painel mostra:
"⚙️ Configurando usuário [nome] — [ID]
Fichas atuais: 3 | Tempo entre fichas: 1h | Recarga: 7 dias

O que quer mudar?
[🎫 Mudar fichas] [⏱️ Mudar tempo entre fichas]
[📅 Mudar dias de recarga] [♾️ Fichas infinitas]
[⏰ Zerar tempo de espera] [❌ Fechar]"

Cada botão abre uma opção:
- 🎫 Mudar fichas → você digita qualquer número. Exemplo: 5 fichas em vez de 3
- ⏱️ Mudar tempo entre fichas → você digita qualquer número de horas. Digite 0 para sem espera
- 📅 Mudar dias de recarga → você digita qualquer número de dias. Exemplo: 3 dias em vez de 7
- ♾️ Fichas infinitas → ativa VIP para essa pessoa. Fichas ilimitadas, sem espera, sem recarga
- ⏰ Zerar tempo de espera → remove o tempo de 1 hora entre fichas para essa pessoa
- ❌ Fechar → fecha o painel sem mudar nada

Tudo que você mudar nesse painel afeta SÓ aquela pessoa. Não muda nada para os outros usuários.

--- COMANDOS DE TROLLAGEM ---
Explicação: Comandos para se divertir com usuários. Ninguém sabe que existem.

90. /owner-mudo [ID]
O bot não responde nada para aquela pessoa. Ela fica sem entender o que aconteceu.

91. /owner-lento [ID]
O bot responde com 30 segundos de atraso para aquela pessoa.

92. /owner-infinito [ID]
O bot fica mostrando "⏳ Analisando..." para aquela pessoa para sempre, sem entregar o resultado.

93. /owner-sem-ficha [ID]
O bot sempre diz que aquela pessoa não tem fichas, mesmo que tenha.

94. /owner-errado [ID]
O bot envia o resultado de um vídeo completamente diferente para aquela pessoa.

95. /owner-fantasma [ID]
O bot fica mostrando que está digitando mas nunca envia nada.

96. /owner-loop [ID]
A tela de confirmação reaparece infinitamente para aquela pessoa.

97. /owner-idioma [ID]
O bot responde para aquela pessoa em japonês, árabe ou russo aleatório.

98. /owner-confuso [ID]
O bot embaralha todas as palavras das respostas para aquela pessoa.

99. /owner-mini [ID]
O bot responde com letras minúsculas tiny: ᵃˢˢⁱᵐ.

100. /owner-eco [ID]
O bot repete tudo que a pessoa escrever antes de responder.

101. /owner-sempre-erro [ID]
O bot sempre diz que deu erro para aquela pessoa.

102. /owner-apelido [ID] [apelido]
O bot chama aquela pessoa pelo apelido em todas as respostas.

103. /owner-falso-vip [ID]
O bot finge que a pessoa é VIP especial mas nunca entrega nada.

104. /owner-contagem [ID]
O bot faz contagem regressiva "5... 4... 3... 2... 1..." antes de responder aquela pessoa.

105. /owner-limpar-troll [ID]
Remove todos os efeitos de trollagem de um usuário e volta ao normal.

--- VIP ---

106. /owner-vip [ID]
Dá status VIP para um usuário: fichas ilimitadas, sem delay e sem limite.

--- CONTROLE DE SERVIDORES ---

107. /owner-bloquear-servidor [ID do servidor]
Bloqueia um servidor inteiro de usar o bot.

108. /owner-desbloquear-servidor [ID do servidor]
Desbloqueia um servidor bloqueado.

109. /owner-limite-custom [ID do servidor] [número]
Muda o limite diário de downloads de um servidor específico.

110. /owner-bloquear-criador [link] [global ou ID do usuário]
ATENÇÃO: Bloqueia um CRIADOR do YouTube, TikTok ou Instagram. Não tem nada a ver com canais do Discord.
- global → ninguém em nenhum servidor baixa daquele criador
- [ID do usuário] → só aquela pessoa não consegue baixar daquele criador

111. /owner-bloquear-video [link] [global ou ID do usuário]
Igual ao anterior mas para um vídeo específico.

112. /owner-desbloquear-criador [link] [global ou ID do usuário]
Remove o bloqueio de um criador.

113. /owner-desbloquear-video [link] [global ou ID do usuário]
Remove o bloqueio de um vídeo.

114. /owner-lista-bloqueios
Lista todos os bloqueios ativos em todo o bot.

--- SISTEMA DE DESFAZER ---

115. /owner-desfazer [número]
Desfaz as últimas ações que você executou. O número pode ser QUALQUER valor que você quiser, não existe um número fixo pré-definido. Exemplos:
- /owner-desfazer 1 → desfaz só a última ação
- /owner-desfazer 4 → desfaz as últimas 4 ações
- /owner-desfazer tudo → desfaz tudo das últimas 24 horas
PRAZO: Só funciona para ações das últimas 24 horas.
CONFIRMAÇÃO: Antes de executar, o bot mostra o que vai ser desfeito e pergunta: "⚠️ Você está prestes a desfazer [X] ações. Confirmar? [✅ Sim] [❌ Não]"

116. /owner-historico-acoes
Mostra as últimas 10 ações executadas com data e hora de cada uma.

--- CONFIRMAÇÃO OBRIGATÓRIA ---
Todo comando /owner que afeta muitos usuários ou muda configurações globais DEVE mostrar confirmação antes de executar:
"⚠️ Você está prestes a [descrição]. Isso vai afetar [quem]. [✅ Confirmar] [❌ Cancelar]"

--- LISTAS ---

117. /owner-vip-lista — lista todos os usuários VIP com data que receberam
118. /owner-troll-lista — lista todos os usuários sendo trollados e qual efeito está ativo
119. /owner-banidos-lista — lista todos os banidos globais com motivo e data
120. /owner-servidor-lista — lista todos os servidores com quantidade de usuários e downloads

--- MANUTENÇÃO ---

121. /owner-modo-manutencao
Para de aceitar novos comandos mas termina o que está em andamento. Avisa todos os servidores: "⚙️ Bot em manutenção..."

================================================================================
PARTE 10 — SISTEMA DE EVENTOS
================================================================================
Explicação: Em datas especiais o bot muda automaticamente. As datas são salvas permanentemente no código. O bot calcula o ano correto sozinho para sempre, sem precisar de atualizações manuais em 2026, 2027, 2028 e todos os anos futuros.

122. /owner-evento — COMANDO COMPLETO DE EVENTOS
Esse comando permite três coisas diferentes:

OPÇÃO 1 — ATIVAR UM EVENTO QUE JÁ EXISTE
Você pode ativar qualquer evento do calendário antes da data oficial. Exemplo: ativar o evento de Natal agora mesmo mesmo não sendo dia 25/12. O evento de Natal oficial no dia 25/12 continua existindo normalmente e não muda nada. Você só está criando uma versão do evento agora, separada do evento oficial.
Como usar: /owner-evento [nome do evento existente]
Exemplo: /owner-evento natal
O bot mostra uma mensagem perguntando:
"🎄 Evento de Natal selecionado!
Quando quer ativar?
[▶️ Agora] [📅 Escolher data e hora]"
Se escolher data e hora, você digita quando começa e quanto tempo dura (pode ser 1 hora, 24 horas, 2 dias, qualquer tempo que você quiser).

OPÇÃO 2 — CRIAR UM EVENTO NOVO COM IA
Você descreve o tema do evento e a IA pesquisa na internet, entende o que é e cria um evento temático completo automaticamente. A IA cria as mensagens, escolhe os emojis e define o que acontece no bot durante o evento.
Como usar: /owner-evento criar [descrição]
Exemplo: /owner-evento criar "Esquadrão 6:7"
O bot vai:
1. Pesquisar na internet o que é "Esquadrão 6:7"
2. Entender o tema (meme, filme, música, etc)
3. Criar um evento completo com mensagens temáticas
4. Mostrar uma prévia para você aprovar antes de ativar
5. Perguntar quanto tempo o evento vai durar
Você aprova ou pede para a IA refazer antes de ativar.

OPÇÃO 3 — VER E GERENCIAR EVENTOS
/owner-evento lista — mostra todos os eventos ativos no momento
/owner-evento-off — desliga o evento manual ativo e volta ao normal

REGRAS DOS EVENTOS MANUAIS:
- Eventos manuais NÃO interferem nos eventos automáticos do calendário. Se você ativar o Natal agora, o Natal oficial do dia 25/12 ainda vai acontecer normalmente.
- Você escolhe quando começa: agora, amanhã, ou qualquer data e hora que quiser
- Você escolhe quanto tempo dura: pode ser 1 hora, 6 horas, 24 horas, 2 dias ou qualquer tempo
- Você pode cancelar o evento manual a qualquer hora com /owner-evento-off

124. CALENDÁRIO DE EVENTOS AUTOMÁTICOS

🎄 25/12 — Natal
Fichas dobradas. Mensagem: "🎄 Feliz Natal! Jesus nasceu e as fichas dobraram!"

🎉 31/12 — Réveillon
Fichas dobradas. Mensagem: "🎉 Último dia do ano! Fichas dobradas!"

🎉 01/01 — Ano Novo
Fichas dobradas. Mensagem: "🎉 Feliz Ano Novo! Fichas dobradas!"

🎭 Carnaval — data variável, calculada automaticamente todo ano
O tempo de espera entre fichas fica ZERADO por 24 horas. O usuário pode usar todas as fichas sem esperar 1 hora entre cada uma.
Mensagem: "🎭 É Carnaval! Sem espera entre fichas hoje!"

🤥 01/04 — Dia da Mentira
O bot finge que as fichas são ilimitadas e deixa o usuário animado. Mas quando ele tenta baixar: "🤥 Mentira! Fichas normais hoje hehe."

🐣 Páscoa — data variável, calculada automaticamente todo ano
O usuário ganha +1 ficha bônus surpresa.
Mensagem: "🐣 Feliz Páscoa! Você ganhou +1 ficha escondida!"

💐 Dia das Mães — 2º domingo de maio, calculado automaticamente todo ano
Fichas dobradas. Mensagem: "💐 Feliz Dia das Mães! Fichas dobradas hoje!"

🎶 24/06 — Festa Junina
O tempo de espera entre fichas é reduzido pela metade. Se normalmente é 1 hora, passa a ser 30 minutos.
Mensagem: "🎶 Arraiá do Vigilante Key! Tempo entre fichas reduzido hoje!"

💝 12/06 — Dia dos Namorados
Fichas dobradas. Mensagem: "💝 Dia dos Namorados! Fichas dobradas!"

👨 Dia dos Pais — 2º domingo de agosto, calculado automaticamente todo ano
Fichas dobradas. Mensagem: "👨 Feliz Dia dos Pais! Fichas dobradas hoje!"

🎮 29/08 — Dia do Gamer
O visual do bot muda para tema de videogame e fichas ficam dobradas.
Mensagem: "🎮 PLAYER 1 ENTERED! Fichas dobradas hoje!"

🎃 31/10 — Halloween
As mensagens do bot ficam com tema assustador e fichas dobradas.
Mensagem: "🎃 BOO! Suas fichas dobraram... se você sobreviver!"

👧 12/10 — Dia das Crianças
As fichas ficam TRIPLICADAS (3 vezes mais) para todo mundo.
Mensagem: "🎈 Feliz Dia das Crianças! Fichas TRIPLICADAS hoje!"

================================================================================
PARTE 11 — O QUE NUNCA PODE SER DESATIVADO
================================================================================
Nenhum ADM e nem o dono do bot pode desligar essas proteções:

🔒 MARCA D'ÁGUA: Gravada em todos os vídeos. Se falhar, o vídeo não é enviado.
🔒 AVISO DE USO PESSOAL: Sempre acompanha o vídeo enviado.
🔒 SISTEMA DE FICHAS: Não pode ser zerado para beneficiar usuários específicos.
🔒 PRIVACIDADE: ADM não pode ver dados pessoais. Apenas ID visível.
🔒 AVISO DE FICHA BAIXA: Sempre avisa quando restar 1 ficha.
🔒 FILTRO DE CONTEÚDO PROIBIDO: Bloqueio de violência e adulto permanente.
🔒 TRAVA DE LIVES: Download de transmissões ao vivo bloqueado permanentemente.
🔒 DELAY DE 5 SEGUNDOS: Intervalo entre comandos não pode ser removido.
🔒 LIMITE DE 3 DOWNLOADS DO MESMO CRIADOR: Não pode ser removido.

================================================================================
REGRAS ABSOLUTAS DO BOT
================================================================================

❌ NUNCA salvar IP ou dados pessoais além do ID do Discord
❌ NUNCA baixar transmissões ao vivo
❌ NUNCA processar violência, conteúdo adulto ou material proibido
❌ NUNCA funcionar em DM — apenas em servidores
❌ NUNCA aceitar links fora do YouTube, TikTok e Instagram
❌ NUNCA enviar vídeo sem a marca d'água do criador original
❌ NUNCA quebrar os Termos de Serviço do Discord
❌ NUNCA quebrar os Termos de Serviço do YouTube, TikTok e Instagram
❌ NUNCA compartilhar dados de usuários com terceiros
❌ NUNCA ser usado para fins comerciais sem autorização do dono
❌ NUNCA guardar vídeos — apagar imediatamente após enviar
❌ NUNCA mostrar o ID de um usuário para outro
❌ NUNCA marcar @everyone sem necessidade real
❌ NUNCA responder outros bots
❌ NUNCA publicar conteúdo ilegal
❌ NUNCA infringir direitos autorais
❌ NUNCA permitir assédio ou perseguição de usuários

✅ SEMPRE responder em português brasileiro de forma amigável
✅ SEMPRE apagar arquivos temporários após enviar o vídeo
✅ SEMPRE proteger a privacidade dos usuários
✅ SEMPRE gravar o @ do criador em todos os vídeos
✅ SEMPRE avisar quando uma ação não for permitida, explicando o motivo
✅ SEMPRE respeitar as regras do servidor onde está instalado
✅ SEMPRE seguir as diretrizes da comunidade do Discord

================================================================================
PARTE 12 — SISTEMA DE AJUDA (/ajuda)
================================================================================
Explicação: Existem três versões do /ajuda. TODOS OS TRÊS usam botões de navegação por páginas ⬅️ e ➡️ porque têm muitos comandos. O formato de páginas funciona igual nos três.

FORMATO PADRÃO DOS TRÊS /ajuda:
"📖 Ajuda — Página 1/3
[lista de comandos]
[⬅️ Anterior] [➡️ Próxima]"

125. /ajuda — PARA USUÁRIOS NORMAIS
Mostra todos os comandos que qualquer pessoa pode usar. Dividido em páginas com botões ⬅️ Anterior e ➡️ Próxima para navegar.

126. /ajuda-adm — PARA ADMINISTRADORES DO SERVIDOR
Mostra todos os comandos /adm. Dividido em páginas com botões ⬅️ Anterior e ➡️ Próxima. Só funciona para quem tem cargo de Administrador. Se um usuário normal tentar: "❌ Você não tem permissão."

127. /ajuda-owner — PARA O DONO E QUEM ELE DER PERMISSÃO
Mostra todos os comandos /owner secretos. Dividido em páginas com botões ⬅️ Anterior e ➡️ Próxima. Só funciona para o dono (ID: 1467333025430900860) e quem ele der permissão com /owner-addadmin. Se qualquer outra pessoa tentar, o bot ignora completamente. Se o dono tirar a permissão de alguém com /owner-removeadmin, o /ajuda-owner some para essa pessoa imediatamente.

================================================================================
PARTE 13 — MENSAGENS PRIVADAS NO SERVIDOR (EPHEMERAL)
================================================================================
Explicação: Mensagem Ephemeral é uma mensagem que o bot envia no servidor mas que SÓ a pessoa que usou o comando consegue ver. Para todo mundo no servidor parece que nada aconteceu. Embaixo da mensagem aparece: "👁️ Só você pode ver esta mensagem · Ignorar mensagem". A mensagem some quando a pessoa clicar em Ignorar ou reiniciar o Discord. Isso é uma função oficial do Discord e só funciona com Slash Commands.

COMANDOS QUE DEVEM USAR MENSAGEM EPHEMERAL (só a pessoa vê):
- /fichas — quando o usuário ver suas fichas, só ele vê a resposta. Ninguém no servidor precisa saber quantas fichas ele tem.
- /perfil — o perfil do usuário é privado. Só ele vê.
- /historico — o histórico de vídeos é privado. Só ele vê.
- /ajuda — a resposta do /ajuda aparece só para quem pediu, não para todo o servidor.
- /ajuda-adm — a resposta aparece só para o ADM que pediu.
- /ajuda-owner — a resposta aparece só para o dono ou quem tem permissão.
- Confirmação de ficha — quando o bot pergunta "Confirmar esse vídeo? (Estoque: X/3)", essa mensagem aparece só para o usuário que está baixando.
- Mensagens de erro — quando der erro, o aviso aparece só para quem errou, não para todo o servidor ver.
- Comandos /adm — as respostas dos comandos de administrador aparecem só para o ADM, não para os membros do servidor ver.
- Comandos /owner — TODOS os comandos /owner sempre usam mensagem ephemeral. Ninguém além do dono e de quem ele deu permissão consegue ver nada.

================================================================================
PARTE 14 — SISTEMA DE VIP E SORTEIO MENSAL
================================================================================
Explicação: Todo dia 1 de cada mês o bot faz um sorteio automático em cada servidor. Uma pessoa é sorteada e ganha VIP por 30 dias. Quando os 30 dias acabam a pessoa perde o VIP. No próximo dia 1 começa um novo sorteio e ela pode ganhar de novo se tiver sorte. É completamente aleatório.

O QUE O VIP CLÁSSICO DÁ:
- 🎫 Fichas dobradas — em vez de 3 fica com 6
- ⏱️ Sem tempo de espera entre fichas
- 🔄 Recarga em 3 dias em vez de 7
- 🏆 Tag VIP aparece no perfil do usuário

QUANDO A PESSOA GANHA O VIP:
O bot envia uma mensagem no PRIVADO (DM) da pessoa que ganhou explicando tudo. A mensagem deve conter:
- Parabéns e quantos dias de VIP ela ganhou
- O que o VIP dá para ela
- Como funciona cada benefício
- No final: "Quer saber mais? Use /ajuda-vip para ver todos os comandos VIP disponíveis."
Isso é enviado no privado para não quebrar nenhuma regra do Discord e para a experiência ser mais especial para a pessoa.

128. /owner-criar-vip
Parâmetros:
- servidor (OPCIONAL) — ID do servidor onde vai acontecer. Se não preencher vai para todos
- nome_evento (OPCIONAL) — nome do evento de VIP
- quando (OPCIONAL) — data e hora para começar. Se não preencher começa agora
- duracao_dias (OPCIONAL) — quantos dias o VIP vai durar. Se não preencher usa 30 dias
- o_que_da (OPCIONAL) — o que o VIP vai dar. Se não preencher usa o VIP clássico padrão

129. /owner-vip-controle
Parâmetros:
- usuario_id (OBRIGATÓRIO) — ID da pessoa que você quer controlar
- acao (OBRIGATÓRIO) — o que você quer fazer: dar, tirar ou estender
- dias (OPCIONAL) — quantos dias de VIP. Só necessário se a ação for dar ou estender

130. /owner-sorteio
Parâmetros:
- servidor (OPCIONAL) — ID do servidor. Se não preencher vai para todos os servidores
- quando (OPCIONAL) — data e hora para o sorteio. Se não preencher começa agora

131. /owner-vip-lista
Sem parâmetros — mostra todos os usuários com VIP ativo em todos os servidores
Depois de aplicar TODAS as atualizações, siga obrigatoriamente:

1. RODAR O BOT imediatamente após terminar o código.

2. CORRIGIR ERROS AUTOMATICAMENTE: Se aparecer qualquer erro no terminal, identificar, corrigir e rodar novamente. Repetir até rodar sem erros.

3. TESTAR OS COMANDOS:
   - /video TRUE — verifica se baixa com marca d'água
   - /video FALSE — verifica se mostra análise E link da música
   - /fichas — verifica se mostra fichas
   - /ajuda — verifica se abre
   - /historico — verifica se funciona
   - /perfil — verifica se funciona
   - /adm — verifica se só ADM usa
   - /owner — verifica se SÓ o ID 1467333025430900860 usa

4. CORRIGIR qualquer erro encontrado nos testes.

5. SÓ CONSIDERAR PRONTO quando tudo estiver funcionando sem erros.
