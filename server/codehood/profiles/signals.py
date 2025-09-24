from django.db.models.signals import post_save
from django.dispatch import receiver

from ..users.models import User
from .models import Profile


@receiver(post_save, sender=User, dispatch_uid="create_profile")
def create_profile(sender, instance: User, created, **kwargs):
    """
    Create a profile for the user after the user is created.
    """
    try:
        instance.profile
    except Profile.DoesNotExist:
        created = True

    if created:
        Profile.objects.create(user=instance)
