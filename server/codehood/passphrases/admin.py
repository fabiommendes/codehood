from django.contrib import admin

from . import models


@admin.register(models.Passphrase)
class PassphraseAdmin(admin.ModelAdmin):
    list_display = ["classroom", "expires"]
    list_filter = ["expires"]
