"""
The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.views.decorators.csrf import csrf_exempt
from django.urls import include, path
from graphene_django.views import GraphQLView  # type: ignore[import-untyped]

from codehood.teapot import teapot_view
from codehood.api import rest, rpc

if settings.DEBUG:
    ADMIN_PATH = "admin/"
    TEAPOT_PATH = "teapot/"
else:
    ADMIN_PATH = "__config__/"
    TEAPOT_PATH = "admin/"

urlpatterns = (
    [
        path(ADMIN_PATH, admin.site.urls),
        path(TEAPOT_PATH, teapot_view, name="teapot"),
        path("api/v1/", rest.urls),
        path("api/rpc/", rpc.urls),
        path("graphql/", csrf_exempt(GraphQLView.as_view(graphiql=True))),
    ]
    + static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
)

if settings.DEBUG:
    # from debug_toolbar.toolbar import debug_toolbar_urls  # type: ignore[import-untyped]
    # urlpatterns += debug_toolbar_urls()

    urlpatterns += [path("silk/", include("silk.urls", namespace="silk"))]
