var path         = require('path');
var childProcess = require('child_process');
var gulp         = require('gulp');
var babel        = require('gulp-babel');
var eslint       = require('gulp-eslint');
var flatten      = require('gulp-flatten');
var mocha        = require('gulp-mocha');
var msbuild      = require('gulp-msbuild');
var concat       = require('gulp-concat');
var jsdoc        = require('gulp-jsdoc-to-markdown');
var remoteSrc    = require('gulp-remote-src');
var changed      = require('gulp-changed');
var del          = require('del');
var through      = require('through2');
var Promise      = require('pinkie');
var pify         = require('pify');

var exec = pify(childProcess.exec, Promise);

// Windows bin
gulp.task('clean-win-bin', function (cb) {
    del('bin/win', cb);
});

gulp.task('build-win-executables', ['clean-win-bin'], function () {
    return gulp
        .src('src/natives/**/*.csproj')
        .pipe(msbuild({
            targets: ['Clean', 'Build']
        }));
});

gulp.task('copy-win-executables', ['build-win-executables'], function () {
    return gulp
        .src([
            'src/natives/**/win/bin/Release/*.exe',
            'src/natives/**/win/bin/Release/*.config'
        ])
        .pipe(flatten())
        .pipe(gulp.dest('bin/win'));
});

// Mac bin
gulp.task('clean-mac-bin', function (callback) {
    del('bin/mac', callback);
});

gulp.task('build-mac-executables', ['clean-mac-bin'], function () {
    function make (options) {
        return through.obj(function (file, enc, callback) {
            if (file.isNull()) {
                callback(null, file);
                return;
            }

            var dirPath = path.dirname(file.path).replace(/ /g, '\\ ');

            exec('make -C ' + dirPath, { env: options })
                .then(function () {
                    callback(null, file);
                })
                .catch(callback);
        });
    }

    return gulp
        .src('src/natives/**/mac/Makefile')
        .pipe(make({
            DEST: path.join(__dirname, 'bin/mac')
        }));
});

gulp.task('copy-mac-scripts', ['clean-mac-bin'], function () {
    return gulp
        .src('src/natives/**/mac/*.scpt')
        .pipe(flatten())
        .pipe(gulp.dest('bin/mac'));
});

// Test
gulp.task('run-playground-win', ['build-win'], function () {
    require('./test/playground/index');
});

gulp.task('run-playground-mac', ['build-mac'], function () {
    require('./test/playground/index');
});

gulp.task('test', ['build-lib'], function () {
    return gulp
        .src('test/tests/*-test.js')
        .pipe(mocha({
            ui:       'bdd',
            reporter: 'spec',
            timeout:  typeof v8debug === 'undefined' ? 2000 : Infinity // NOTE: disable timeouts in debug
        }));
});

// General tasks
gulp.task('update-device-database', function () {
    function transform () {
        return through.obj(function (file, enc, callback) {
            var deviceDatabase = {};

            JSON
                .parse(file.contents.toString())
                .forEach(function (device) {
                    var deviceId       = device['Device Name'].toLowerCase().split(' ').join('');
                    var portraitWidth  = Number(device['Portrait Width']);
                    var landscapeWidth = Number(device['Landscape Width']);

                    if (!isNaN(portraitWidth) && !isNaN(landscapeWidth)) {
                        deviceDatabase[deviceId] = {
                            portraitWidth:  portraitWidth,
                            landscapeWidth: landscapeWidth
                        };
                    }
                });

            file.contents = new Buffer(JSON.stringify(deviceDatabase));

            callback(null, file);
        });
    }

    var destDir = 'data/';

    return remoteSrc('devices.json', { base: 'http://viewportsizes.com/' })
        .pipe(transform())
        .pipe(changed(destDir, { hasChanged: changed.compareSha1Digest }))
        .pipe(gulp.dest(destDir));
});

gulp.task('lint', function () {
    return gulp
        .src([
            'src/**/*.js',
            'test/**/*.js',
            '!test/playground/public/**/*',
            'Gulpfile.js'
        ])
        .pipe(eslint())
        .pipe(eslint.format())
        .pipe(eslint.failAfterError());
});

gulp.task('clean-lib', function (cb) {
    del('lib', cb);
});

gulp.task('transpile-lib', ['lint', 'clean-lib'], function () {
    return gulp
        .src('src/**/*.js')
        .pipe(babel())
        .pipe(gulp.dest('lib'));
});

gulp.task('build-lib', ['transpile-lib', 'docs']);

gulp.task('build-win', ['build-lib', 'copy-win-executables']);
gulp.task('build-mac', ['build-lib', 'build-mac-executables', 'copy-mac-scripts']);

gulp.task('docs', ['transpile-lib'], function () {
    var destDir = './';

    return gulp
        .src('lib/**/*.js')
        .pipe(concat('API.md'))
        .pipe(jsdoc({ plugin: 'dmd-plugin-async' }))
        .pipe(changed(destDir, { hasChanged: changed.compareSha1Digest }))
        .pipe(gulp.dest(destDir));
});
