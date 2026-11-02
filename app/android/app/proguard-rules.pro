# ===========================================================================
# ElyWalk — règles R8 / ProGuard (build release)
#
# La version de production est minifiée et obscurcie (`minifyEnabled true`)
# afin de satisfaire l'exigence « Optimisation du code DEX » de Google Play
# (seuil d'obscurcissement ≥ 25 %).
#
# Principe : on ne conserve QUE ce qui est résolu par réflexion ou par nom de
# classe. Tout le reste (y compris les SDK Google/Firebase, qui fournissent
# leurs propres règles « consumer ») peut être renommé par R8.
# ===========================================================================

# --- Métadonnées : annotations (Capacitor) + traces lisibles ---------------
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod, Exceptions
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile

# --- Capacitor -------------------------------------------------------------
# `assets/capacitor.plugins.json` référence chaque plugin par son nom complet
# de classe : ces classes (et leurs méthodes annotées) sont chargées par
# réflexion et ne doivent pas être renommées.
# (Capacitor fournit déjà ces règles en « consumer rules » ; on les répète ici
#  pour rester explicite et couvrir les plugins tiers.)
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}

# Ponts JavaScript exposés à la WebView (bridge Capacitor, SystemBars…).
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Plugins Cordova éventuellement ajoutés via capacitor-cordova-android-plugins.
-keep public class * extends org.apache.cordova.CordovaPlugin { *; }

# --- Plugins natifs ElyWalk -----------------------------------------------
# Enregistrés explicitement dans MainActivity et appelés depuis le JavaScript.
-keep class com.elysium.elywalk.StepCounterPlugin { *; }
-keep class com.elysium.elywalk.TrackingPlugin { *; }
# Widget, services de premier plan et receiver : instanciés par le système à
# partir du manifeste (R8 les conserve déjà, on le rend explicite).
-keep class com.elysium.elywalk.ElyWalkWidget { *; }
-keep class com.elysium.elywalk.StepCounterService { *; }
-keep class com.elysium.elywalk.TrackingService { *; }
-keep class com.elysium.elywalk.BootReceiver { *; }

# --- Avertissements des SDK tiers -----------------------------------------
# Classes optionnelles référencées mais absentes du classpath : elles ne
# doivent pas faire échouer la minification.
-dontwarn com.google.android.gms.ads.**
-dontwarn com.google.android.play.core.**
-dontwarn org.apache.cordova.**
