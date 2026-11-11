# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------------------
# Meta Audience Network (régie publicitaire — voir MetaAdsPlugin.java)
# À conserver même si `minifyEnabled` est aujourd'hui à false : le SDK est
# chargé par réflexion (adaptateurs, rapports AdChoices).
# ---------------------------------------------------------------------------
-keep class com.facebook.ads.** { *; }
-keep class com.facebook.ads.internal.** { *; }
-dontwarn com.facebook.ads.**
-keepattributes *Annotation*

# ---------------------------------------------------------------------------
# Chartboost Core + Mediation (médiation publicitaire — voir
# ChartboostMediationAdsPlugin.java). Les adaptateurs partenaires et les modules
# sont instanciés par réflexion depuis la configuration serveur : ils doivent
# conserver leurs noms de classe et leurs constructeurs.
# ---------------------------------------------------------------------------
-keep class com.chartboost.core.** { *; }
-keep class com.chartboost.chartboostmediationsdk.** { *; }
-keep class com.chartboost.mediation.** { *; }
-keep class com.chartboost.sdk.** { *; }
-dontwarn com.chartboost.**

# Adaptateurs partenaires chargés dynamiquement.
-keep class * extends com.chartboost.core.initialization.Module { *; }
-keep class * implements com.chartboost.mediation.partneradapter.** { *; }

# kotlinx.serialization est utilisé par Chartboost pour (dé)sérialiser la
# configuration et les événements ILRD.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class * { kotlinx.serialization.KSerializer serializer(...); }
