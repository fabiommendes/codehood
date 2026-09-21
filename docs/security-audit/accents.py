"""
Acentuacao da prosa em tempo de renderizacao.

Os dados em `findings.py` e `issues.py` sao escritos em ASCII para que nenhuma
chave de dicionario dependa de acento; a forma final em pt-BR e aplicada aqui,
palavra por palavra, e apenas sobre prosa - nunca sobre trechos de codigo, que
sao ingles e nao devem ser tocados.
"""

from __future__ import annotations

import re

#: Pares `palavra sem acento -> palavra acentuada`. Capitalizacao e tratada
#: automaticamente por `_apply`, entao basta a forma minuscula.
WORDS = {
    # -cao / -coes
    "acao": "ação", "acoes": "ações",
    "aplicacao": "aplicação", "aplicacoes": "aplicações",
    "atribuicao": "atribuição",
    "autenticacao": "autenticação", "autorizacao": "autorização",
    "auditoria": "auditoria",
    "checagem": "checagem",
    "condicao": "condição", "condicoes": "condições",
    "configuracao": "configuração", "configuracoes": "configurações",
    "contabilidade": "contabilidade",
    "correcao": "correção", "correcoes": "correções",
    "criacao": "criação",
    "decisao": "decisão", "decisoes": "decisões",
    "definicao": "definição",
    "divulgacao": "divulgação",
    "documentacao": "documentação",
    "escalada": "escalada",
    "excecao": "exceção", "excecoes": "exceções",
    "execucao": "execução",
    "exportacao": "exportação",
    "funcao": "função", "funcoes": "funções",
    "injecao": "injeção",
    "instancia": "instância", "instancias": "instâncias",
    "operacao": "operação", "operacoes": "operações",
    "opcao": "opção", "opcoes": "opções",
    "padrao": "padrão", "padroes": "padrões",
    "permissao": "permissão", "permissoes": "permissões",
    "protecao": "proteção",
    "razao": "razão",
    "renderizacao": "renderização",
    "restricao": "restrição", "restricoes": "restrições",
    "revogacao": "revogação",
    "sanitizacao": "sanitização",
    "serializacao": "serialização",
    "sessao": "sessão", "sessoes": "sessões",
    "situacao": "situação",
    "validacao": "validação",
    "verificacao": "verificação",
    "versao": "versão", "versoes": "versões",
    "informacao": "informação",
    "reproducao": "reprodução",
    "utilizacao": "utilização",
    "delimitacao": "delimitação",
    "mitigacao": "mitigação",
    "paginacao": "paginação",
    "apresentacao": "apresentação",
    "acentuacao": "acentuação",
    # -ncia
    "ausencia": "ausência",
    "consequencia": "consequência", "consequencias": "consequências",
    "dependencia": "dependência", "dependencias": "dependências",
    "evidencia": "evidência", "evidencias": "evidências",
    "experiencia": "experiência",
    "referencia": "referência", "referencias": "referências",
    "sequencia": "sequência",
    "presenca": "presença",
    # -orio / -ario / -erio
    "criterio": "critério", "criterios": "critérios",
    "diretorio": "diretório", "diretorios": "diretórios",
    "historico": "histórico",
    "necessario": "necessário", "necessaria": "necessária",
    "obrigatorio": "obrigatório", "obrigatorios": "obrigatórios",
    "obrigatoria": "obrigatória", "obrigatorias": "obrigatórias",
    "relatorio": "relatório",
    "repositorio": "repositório", "repositorios": "repositórios",
    "usuario": "usuário", "usuarios": "usuários",
    "proprio": "próprio", "propria": "própria",
    "proprios": "próprios", "proprias": "próprias",
    "previo": "prévio", "previa": "prévia",
    "serie": "série",
    "obvio": "óbvio",
    # c-cedilha
    "seguranca": "segurança",
    "servico": "serviço", "servicos": "serviços",
    "cabecalho": "cabeçalho", "cabecalhos": "cabeçalhos",
    "laco": "laço",
    "comeco": "começo",
    "esforco": "esforço",
    # proparoxitonas e outros
    "codigo": "código",
    "metodo": "método", "metodos": "métodos",
    "metodologica": "metodológica", "metodologico": "metodológico",
    "numero": "número", "numeros": "números",
    "parametro": "parâmetro", "parametros": "parâmetros",
    "publico": "público", "publica": "pública",
    "publicos": "públicos", "publicas": "públicas",
    "unico": "único", "unica": "única",
    "unicos": "únicos", "unicas": "únicas",
    "pratica": "prática", "praticas": "práticas",
    "semantica": "semântica",
    "especifico": "específico", "especifica": "específica",
    "contabil": "contábil",
    "possivel": "possível", "possiveis": "possíveis",
    "variavel": "variável", "variaveis": "variáveis",
    "responsavel": "responsável",
    "disponivel": "disponível",
    "util": "útil",
    "minimo": "mínimo", "maximo": "máximo",
    "matricula": "matrícula", "matriculas": "matrículas",
    "vitima": "vítima", "vitimas": "vítimas",
    "trilha": "trilha",
    "saida": "saída",
    "area": "área", "areas": "áreas",
    "superficie": "superfície", "superficies": "superfícies",
    "pagina": "página", "paginas": "páginas",
    "explorabilidade": "explorabilidade",
    "explorável": "explorável",
    # monossilabos e advérbios
    "nao": "não",
    "sao": "são",
    "tres": "três",
    "alem": "além",
    "tambem": "também",
    "apos": "após",
    "atraves": "através",
    "atras": "atrás",
    "ate": "até",
    "ja": "já",
    "ha": "há",
    "so": "só",
    "porem": "porém",
    "ninguem": "ninguém",
    "alguem": "alguém",
    "sera": "será",
    "tera": "terá",
    "havera": "haverá",
    "anotar": "anotar",
    "pre-condicao": "pré-condição",
    "anonimo": "anônimo",
    "atualizacao": "atualização",
    "compilacao": "compilação",
    "conteudo": "conteúdo", "conteudos": "conteúdos",
    "decodificacao": "decodificação",
    "demonstracao": "demonstração",
    "deteccao": "detecção",
    "entao": "então",
    "estacao": "estação",
    "exibicao": "exibição",
    "falsificacao": "falsificação",
    "integracao": "integração",
    "legitimo": "legítimo", "legitima": "legítima",
    "logica": "lógica",
    "mao": "mão",
    "marcacao": "marcação",
    "producao": "produção",
    "proxima": "próxima", "proximo": "próximo",
    "questao": "questão", "questoes": "questões",
    "reducao": "redução",
    "regressao": "regressão",
    "requisicao": "requisição", "requisicoes": "requisições",
    "revisao": "revisão",
    "sistemica": "sistêmica", "sistemico": "sistêmico",
    "sugestao": "sugestão",
    "traducao": "tradução",
    "ultima": "última", "ultimo": "último",
    "visao": "visão",
    "forca": "força",
    "privilegio": "privilégio", "privilegios": "privilégios",
    "arbitrario": "arbitrário",
    "celulas": "células",
    "temporaria": "temporária",
    "momentanea": "momentânea",
    "robo": "robô",
    "convem": "convém",
    "hipotese": "hipótese", "hipoteses": "hipóteses",
    "analise": "análise",
}


#: A copula "e" nao da para inferir automaticamente sem ambiguidade (conjuncao
#: vs. verbo), entao cada ocorrencia da prosa foi decidida a mao. Aplicado
#: antes de WORDS, com casamento exato.
PHRASES = [
    ("credencial valida", "credencial válida"),
    ("conta valida", "conta válida"),
    ("exploravel", "explorável"),
    ("encadeavel", "encadeável"),
    ("codigo-fonte", "código-fonte"),
    ("P1 e o que deve", "P1 é o que deve"),
    ("P3 e endurecimento", "P3 é endurecimento"),
    ("(F4) e independente", "(F4) é independente"),
    ("E o unico achado", "É o único achado"),
    ("csvRows` vem de", "csvRows` vêm de"),
    ("que e explor", "que é explor"),
    ("nao e explor", "não é explor"),
    ("Nao e explor", "Não é explor"),
    ("Nenhum e explor", "Nenhum é explor"),
    ("vitima e admin", "vítima é admin"),
    ("onvite e a unica", "onvite é a única"),
    ("enrollments` e carregado", "enrollments` é carregado"),
    ("ator e membro", "ator é membro"),
    ("isso e dado", "isso é dado"),
    ("usuario e rejeitado", "usuário é rejeitado"),
    ("ja e `html", "já é `html"),
    ("ator e ignorado", "ator é ignorado"),
    ("valor e escrito", "valor é escrito"),
    ("que e tomada", "que é tomada"),
    ("admin, e comprometimento", "admin, é comprometimento"),
    ("efeito e alcancado", "efeito é alcançado"),
    ("Aluno e barrado", "Aluno é barrado"),
    ("total e trivial", "total é trivial"),
    ("e simplesmente contornada", "é simplesmente contornada"),
    ("achado e de consistencia", "achado é de consistência"),
    ("este e o unico", "este é o único"),
    ("hoje e contabil", "hoje é contábil"),
    ("impacto e contabil", "impacto é contábil"),
    ("URL e o hash", "URL é o hash"),
    ("Nao e um controle", "Não é um controle"),
    ("privatePayload` e selecionado", "privatePayload` é selecionado"),
    ("nunca e lido", "nunca é lido"),
    ("so e emitida", "só é emitida"),
    ("versionado e o exemplo", "versionado é o exemplo"),
    ("falha e silencioso", "falha é silencioso"),
    ("alvo e sempre", "alvo é sempre"),
    ("isolamento e feito", "isolamento é feito"),
    ("inquilino e o curso", "inquilino é o curso"),
    ("objeto e carregado", "objeto é carregado"),
    ("ela e interpretada", "ela é interpretada"),
    ("instrutor e escalada", "instrutor é escalada"),
    ("A e INSTRUCTOR", "A é INSTRUCTOR"),
    ("convidado e STUDENT", "convidado é STUDENT"),
    ("nao e afetada", "não é afetada"),
    ("nao e feito", "não é feito"),
    ("defeito e a mesma", "defeito e a mesma"),
    ("gravado e sempre", "gravado é sempre"),
    ("que e exatamente", "que é exatamente"),
    ("risco e que", "risco é que"),
    ("que e publico por design", "que é público por design"),
    ("risco real e de", "risco real é de"),
    ("O padrao do projeto", "O padrão do projeto"),
    ("e o certo", "é o certo"),
    ("que e a prova", "que é a prova"),
    ("que e o que", "que é o que"),
    ("que e a superficie", "que é a superfície"),
    ("e alcancada apenas", "é alcançada apenas"),
    ("e a chave de leitura", "é a chave de leitura"),
    ("e a unica que nao faz", "é a única que não faz"),
    ("e uma lacuna pontual", "é uma lacuna pontual"),
    ("e o escape hatch", "é o escape hatch"),
    ("sessao e `httpOnly`", "sessão é `httpOnly`"),
    ("e tomada de conta completa", "é tomada de conta completa"),
    ("e comprometimento total", "é comprometimento total"),
    ("e dado pessoal", "é dado pessoal"),
    ("e a regra", "é a regra"),
    ("e o teste", "é o teste"),
    ("e recusa qualquer nome", "e recusa qualquer nome"),
    ("e o que impede", "é o que impede"),
    ("e o modo de falha", "é o modo de falha"),
    ("e exatamente o tipo", "é exatamente o tipo"),
    ("e a defesa contra", "é a defesa contra"),
    ("e o hash do conteudo", "é o hash do conteúdo"),
    ("e a mesma correcao", "é a mesma correção"),
    ("e de defesa em profundidade", "é de defesa em profundidade"),
    ("e o roster", "é o roster"),
    ("e sempre uma sessao", "é sempre uma sessão"),
]


def _phrases(text: str) -> str:
    for a, b in PHRASES:
        text = text.replace(a, b)
    return text


_PATTERN = re.compile(
    r"\b(" + "|".join(sorted(map(re.escape, WORDS), key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)


def _replace(match: re.Match) -> str:
    word = match.group(0)
    fixed = WORDS[word.lower()]
    if word.isupper() and len(word) > 1:
        return fixed.upper()
    if word[0].isupper():
        return fixed[0].upper() + fixed[1:]
    return fixed


def acc(text: str) -> str:
    """Acentua a prosa em `text`, deixando `codigo entre crases` intacto."""
    parts = re.split(r"(`[^`]*`)", _phrases(text))
    return "".join(p if p.startswith("`") else _PATTERN.sub(_replace, p)
                   for p in parts)


def acc_markdown(text: str) -> str:
    """Como `acc`, mas tambem preserva blocos cercados por ``` e tabelas."""
    out, in_fence = [], False
    for line in text.split("\n"):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            out.append(line)
        elif in_fence or line.lstrip().startswith("|"):
            out.append(line)
        else:
            out.append(acc(line))
    return "\n".join(out)
