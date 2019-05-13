import * as fs from 'fs';
import { PNG } from 'pngjs';
import colorConverter from './colorConverter';
import logger from './logger';
import { PixelWorker } from './pixelWorker';
import userInput, { IProgramParameters } from './userInput';
import versionChecker from './versionChecker';

// tslint:disable-next-line: variable-name
import imageDither from 'image-dither';

async function startAndGetUserInput() {
    // Every once in a while check for updates. So it will startup with update installed next time;
    setInterval(async () => {
        await versionChecker.start();
    },          1000 * 60 * 20); /* Every 20 mins */

    await versionChecker.start();
    // update logging will be the first thing that shows up after start.

    await userInput.gatherProgramParameters();

    if (!userInput.currentParameters) {
        throw new Error("Параметры не могут быть проанализированы");
    }

    logger.log(`-------------------------------------------\nЗапускаем с параметрами: ${
        JSON.stringify(userInput.currentParameters)}`);

    return start(userInput.currentParameters);
}

async function start(params: IProgramParameters) {
    logger.log('Чтение входной картинки...');
    fs.createReadStream(params.imgPath)
    .pipe(new PNG())
    .on('parsed', async function (this: PNG) {
        logger.log(`Закончил чтение. ${this.width} x ${this.height}`);
        if (params.ditherTheImage) {
            // Dither the image (makes photos look better, more realistic with color depth)
            /* matrices available to use.
            Dither.matrices.atkinson
            Dither.matrices.burkes
            Dither.matrices.floydSteinberg
            Dither.matrices.jarvisJudiceNinke
            Dither.matrices.oneDimensional
            Dither.matrices.sierraLite
            Dither.matrices.sierra2
            Dither.matrices.sierra3
            Dither.matrices.stucki
            Dither.matrices.none
            */
            const options = {
                findColor: (channelArray: [number, number, number, number]) => {
                    const convertedColor = colorConverter.convertActualColor(
                        channelArray[0],
                        channelArray[1],
                        channelArray[2],
                        );

                    const resultArr = colorConverter.getActualColor(convertedColor);
                    resultArr.push(channelArray[3]);
                    return resultArr;
                },
                matrix: imageDither.matrices.floydSteinberg,
            };
            const dither = new imageDither(options);
            const ditheredImg = dither.dither(this.data, this.width, undefined);
            const ditheredDataBuffer = Buffer.from(ditheredImg);
            this.data = ditheredDataBuffer;
            this.pack().pipe(fs.createWriteStream('expectedOutput.png')).on('close', () => {
                logger.log('expectedOutput.png <- Содержит окончательное ожидаемое изображение.');
            });
        } else {
            // Convert all colors to 24 provided by the website beforehand
            // and output a picture for a preview.
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    // tslint:disable-next-line: no-bitwise
                    const idx = (this.width * y + x) << 2;

                    const r = this.data[idx + 0];
                    const g = this.data[idx + 1];
                    const b = this.data[idx + 2];
                    const convertedColor = colorConverter.convertActualColor(r, g, b);
                    const resultArr = colorConverter.getActualColor(convertedColor);
                    this.data[idx + 0] = resultArr[0];
                    this.data[idx + 1] = resultArr[1];
                    this.data[idx + 2] = resultArr[2];
                }
            }
            this.pack().pipe(fs.createWriteStream('expectedOutput.png')).on('close', () => {
                logger.log('expectedOutput.png <- Содержит окончательное ожидаемое изображение.');
            });
        }

        const worker = await PixelWorker.create(this,
                                                { x: params.xLeftMost, y: params.yTopMost },
                                                params.doNotOverrideColors,
                                                params.customEdgesMapImagePath,
            );

        logger.log("Начинаем!");

        await worker.waitForComplete();
        // await for the full process. Here full image should be finished.

        logger.log('Картина готова!');

        if (!params.constantWatch) {
            // Job is done. Exit the process...
            logger.log('Всё готово!');
            process.exit(0);
            return;
        }
        // Do not exit process, will continue to listen to socket changes
        // and replace non matching pixels.
        logger.log('Продолжаю следить...');
    }).on('error', (error) => {
        logger.logError(`Не удалось загрузить изображение, убедитесь, что изображение является допустимым файлом PNG.\n${
            error.message}`);
    });
}

startAndGetUserInput().catch();
