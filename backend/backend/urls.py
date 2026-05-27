from django.contrib import admin
from django.urls import path, include
from rest_framework import routers
from puzzle import views
from puzzle import auth_views

router = routers.DefaultRouter()
router.register(r'puzzles', views.PuzzleView, 'puzzle')

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include(router.urls)),
    path('api/auth/register/', auth_views.register),
    path('api/auth/login/', auth_views.login_view),
    path('api/auth/logout/', auth_views.logout_view),
    path('api/auth/me/', auth_views.me),
]
