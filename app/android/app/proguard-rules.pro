# ===========================================================================
# ElyWalk — règles R8 / ProGuard (build release)
#
# La version de production est minifiée et obscurcie (`minifyEnabled true`)
# afin de satisfaire l'exigence « Optimisation R8 » de Google Play (réduction
# du code, réduction des ressources et obscurcissement ≥ 25 %).
#
# Principe : on ne conserve QUE ce qui est résolu par réflexion ou par nom de
# classe. Tout le reste (y compris les SDK Google/Firebase, qui fournissent
# leurs propres règles « consumer ») peut être renommé par R8.
#
# ⚠️ Les règles de conservation doivent rester COMPLÈTES : activer R8 avec une
# règle manquante transforme une fonctionnalité en plantage au lancement.
# ===========================================================================

# --- Métadonnées : annotations (Capacitor) + traces lisibles ---------------
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod, Exceptions
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile

# --- Optimisation (recommandation R8 de Google Play) ----------------------
# La réduction ET l'optimisation viennent du build, pas de ce fichier :
# `minifyEnabled true` + `shrinkResources true` (app/build.gradle) et
# `android.enableR8.fullMode=true` (gradle.properties). C'est cet ensemble que
# Play évalue pour l'avertissement « Améliorez la mémoire et les performances
# de votre appli avec l'optimisation R8 ».
#
# On n'ajoute volontairement PAS `-repackageclasses ''` ni
# `-allowaccessmodification` : ces options ne changent rien au verdict de Play
# mais déplacent des classes que des SDK lisent par leur nom complet
# (`Class.forName`, journaux de plantage, réflexion interne de Firebase,
# Google Mobile Ads et des plugins Capacitor). Le gain de performance est
# marginal ; le risque d'un plantage au lancement impossible à tester ici est
# réel. Le mode complet de R8 optimise déjà entre classes sans elles.

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

# Plugin Capacitor du podomètre tiers (@capgo/capacitor-pedometer) : il ne
# fournit pas de règles « consumer ». Sans cette ligne, R8 peut renommer ou
# supprimer ses méthodes `@PluginMethod` et l'appel échoue.
-keep class app.capgo.pedometer.** { *; }

# Plugins Cordova éventuellement ajoutés via capacitor-cordova-android-plugins.
-keep public class * extends org.apache.cordova.CordovaPlugin { *; }

# --- Plugins natifs ElyWalk -----------------------------------------------
# Enregistrés explicitement dans MainActivity et appelés depuis le JavaScript.
# Ne pas utiliser allowoptimization sur les plugins Capacitor appelés par réflexion.
-keep class com.elysium.elywalk.StepCounterPlugin { *; }
-keep class com.elysium.elywalk.TrackingPlugin { *; }
-keep class com.elysium.elywalk.MetaAdsPlugin { *; }
# Widget, services de premier plan, receiver et activité : instanciés par le
# système à partir du manifeste (R8 les conserve déjà, on le rend explicite).
-keep class com.elysium.elywalk.ElyWalkWidget { *; }
-keep class com.elysium.elywalk.StepCounterService { *; }
-keep class com.elysium.elywalk.TrackingService { *; }
-keep class com.elysium.elywalk.BootReceiver { *; }
-keep class com.elysium.elywalk.MainActivity { *; }

# --- Meta Audience Network (régie publicitaire) et Facebook SDK ----------
# Le SDK Audience Network est désormais embarqué (publicité principale de
# l'application) : ses classes sont résolues par réflexion interne et par le
# manifeste fusionné (com.facebook.ads.AudienceNetworkActivity). On les
# conserve telles quelles.
-keep class com.facebook.ads.** { *; }
-keep class com.facebook.ads.internal.** { *; }
-keeppackagenames com.facebook.*
-keep public class com.facebook.ads.** { public protected *; }

# Supprimer les avertissements de classes manquantes (R8 missing_rules.txt) :
# - com.facebook.infer.annotation.** (annotations Infer du SDK Meta)
# - com.facebook.** (handlers Facebook optionnels de Firebase Auth et composants internes)
-dontwarn com.facebook.infer.annotation.**
-dontwarn com.facebook.ads.internal.**
-dontwarn com.facebook.**

# --- Dépendances optionnelles de Firebase Authentication ------------------
# Le plugin @capacitor-firebase/authentication compile des handlers pour
# tous les fournisseurs (Google, Facebook, Play Games, Credentials).
# Lorsqu'ils ne sont pas inclus au runtime, R8 doit ignorer les références.
-dontwarn com.google.android.gms.auth.**
-dontwarn com.google.android.gms.games.**
-dontwarn com.google.android.libraries.identity.googleid.**
-dontwarn androidx.credentials.**

# --- Avertissements des SDK tiers -----------------------------------------
# Classes optionnelles référencées mais absentes du classpath : elles ne
# doivent pas faire échouer la minification.
-dontwarn com.google.android.gms.ads.**
-dontwarn com.google.android.play.core.**
-dontwarn org.apache.cordova.**

# --- Ressources réduites mais référencées dynamiquement --------------------
# Google Play mesure aussi la réduction des ressources : elle est active
# (`shrinkResources true`). Ces ressources sont référencées par nom et doivent
# survivre — voir res/raw/keep.xml pour la liste détaillée.
# (Rien à ajouter ici : `-keep` sur les classes suffit.)
