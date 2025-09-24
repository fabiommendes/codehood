class ConfigError(Exception):
    """
    Exception raised for errors in the configuration file.
    """

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message
