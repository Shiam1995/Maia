#include <stdio.h>


float celsius_to_fahrenheit(float celsius, float fahr) {
    //converts C to F
    // limit is float

    printf("%3.0f %6.1f\n", celsius, fahr);

}




// a big text
//float c_to_f(float x,y);




int main(void) {

    float fahr, celsius;
    int lower, upper, step;
    float x,y;
    x = y = 10;


    lower = 0;
    upper = 300;
    step = 20;



    fahr = lower;
    printf("Conversion table\n");

    celsius_to_fahrenheit(x,y);
    /*
    while (fahr <= upper) {
        celsius = (5.0/9.0) * (fahr-32.0);
        printf("%3.0f %6.1f\n", fahr, celsius);
        fahr = fahr + step;
    }
    */
}
