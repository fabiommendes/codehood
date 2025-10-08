from enum import Enum


class TextFormat(Enum):
    """
    How to interpret textual strings.
    """

    MARKDOWN = "md"
    TEXT = "text"


class MediaType(Enum):
    """
    The type of the media object.
    """

    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    CODE = "code"
    DOCUMENT = "document"
    ARCHIVE = "archive"


class SupportedLanguages(Enum):
    NoneType_None = None
    placeholder = "placeholder"


class InputType(Enum):
    """
    The type of input field to be used for the essay.

    """

    TEXT = "text"
    RICHTEXT = "richtext"
    CODE = "code"


class ProgrammingLanguage(Enum):
    PYTHON = "python"
    JAVASCRIPT = "javascript"
    JAVA = "java"
    C = "c"
    CPP = "cpp"
    RUBY = "ruby"
    GO = "go"
    RUST = "rust"
    PHP = "php"
    HTML = "html"
    CSS = "css"
    SQL = "sql"
    BASH = "bash"
    R = "r"
    SWIFT = "swift"
    KOTLIN = "kotlin"
    TYPESCRIPT = "typescript"
    DART = "dart"
    SCALA = "scala"
    ELIXIR = "elixir"
    CLOJURE = "clojure"
    HASKELL = "haskell"
    LUA = "lua"
    ERLANG = "erlang"
    LARK = "lark"


class Style(Enum):
    """
    Apply styles on how the text should be displayed.

    """

    SIMPLE = "simple"
    HEADLINE = "headline"
    CODE = "code"


class PrivateKeys(Enum):
    """
    A list of private keys that are stripped from the document before showing it to students.  This defines a different schema since some of those keys are optional.

    """

    CORRECT = "correct"
    ANSWER_KEY = "answer_key"
    COMMENT = "comment"
    FEEDBACK = "feedback"
    SHUFFLE = "shuffle"
    FIXED = "fixed"
    EXAMPLES = "examples"
    CONF = "conf"


class ArtifactType(Enum):
    """
    The type of artifact produced by the compilation. It is used to determine how to execute the code.
    """

    LIB = "lib"
    EXECUTABLE = "executable"
