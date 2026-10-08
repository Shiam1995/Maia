#include <stdio.h>



// a big text
//float c_to_f(float x,y);

int main(void) {

    float fahr, celsius;
    int lower, upper, step;


    lower = 0;
    fahr = upper = 300;
    step = 20;

    fahr = 300;
    printf("Conversion table\n");

    //celsius_to_fahrenheit(x,y);

    while (fahr >= lower) {
        celsius = (5.0/9.0) * (fahr-32.0);
        printf("%3.0f %6.1f\n", fahr, celsius);
        fahr = fahr - step;
    }

}
