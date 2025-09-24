from django.contrib import admin

from . import models


@admin.register(models.TimeSlot)
class TimeSlotAdmin(admin.ModelAdmin):
    list_display = ["classroom", "start", "end", "day"]
    list_filter = ["day", "classroom__status"]


@admin.register(models.Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ["time_slot", "title", "start", "week"]
    list_filter = [
        "time_slot__day",
        "time_slot__classroom",
        "is_holliday",
        "start",
    ]
